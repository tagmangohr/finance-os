import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { recordCronRun } from "@/lib/ops/cron-runs";
import { isCronEnabled } from "@/lib/ops/cron-settings";
import { invalidateOrg } from "@/lib/cache/org-cache";
import { drainSyncJobs, pollCashfreeSubscriptions } from "@/lib/connectors/jobs";
import { reconcileCashfreeFees } from "@/lib/connectors/cashfree-fees";
import { syncGatewaySubscriptions } from "@/lib/subscriptions/sync";
import { syncGatewayInvoices, tagSubscriptionCharges } from "@/lib/subscriptions/invoices";
import { categorizeBankTransactions } from "@/lib/expenses/categorize";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";
// 300s: this is the heavy reconciliation pass — per-connector subscription polling,
// fee recon, invoice sync and bank categorization across every org.
export const maxDuration = 300;

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];
const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz", "mercury", "google_sheets", "excel"];

/**
 * GET /api/cron/reconcile — the heavy post-sync reconciliation, EXTRACTED from
 * nightly-sync's after() into its own cron with its own full budget.
 *
 * Why split: these phases (Cashfree subscription poll + settlement-fee recon,
 * Stripe/Razorpay subscription + invoice sync, subscription-charge tagging, bank
 * categorization) used to run at the tail of nightly-sync's after(), behind the drain
 * — where the cumulative per-connector deadlines could exhaust the function budget and
 * silently truncate the tail (that's why sub-dupe-watch showed "no runs"). On its own
 * cron it can never be starved by the main sync, and — wrapped in recordCronRun — a
 * timeout leaves a "running" row that Sync Health surfaces instead of hiding.
 *
 * Runs at 02:00 IST (20:30 UTC): ~90 min after nightly-sync (00:30 IST) has enqueued
 * the night's backfills and the per-minute worker has drained them, and well before
 * the 07:30 IST snapshot rebuilds the rollups off reconciled data. Idempotent /
 * fill-only throughout, so overlaps and retries are safe.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    const supabase = await createServiceClient();
    // Paused via the Sync Health toggle → no-op (no run logged; the page shows it "off").
    if (!(await isCronEnabled(supabase, "reconcile"))) return;

    try {
      await recordCronRun(supabase, "reconcile", async () => {
        const { data: connectors } = await supabase
          .from("connectors").select("*").eq("status", "active").in("type", SYNCABLE_TYPES);
        const conns = (connectors ?? []) as ConnectorRow[];
        const cashfreeConnectors = conns.filter((c) => c.type === "cashfree");
        const subApiConnectors = conns.filter((c) => c.type === "stripe" || c.type === "razorpay");
        const bankOrgIds = Array.from(new Set(conns.filter((c) => c.type === "mercury").map((c) => c.org_id)));
        const fyStartMs = new Date("2026-04-01T00:00:00+05:30").getTime();
        const now = new Date();
        const worker = randomUUID();

        // Collect per-phase failures so the run is marked FAILED (→ Sync Health red) if
        // anything didn't reconcile — instead of recording a misleading "ok". Every phase
        // is fill-only, so a failure in one never blocks the others; we run them all, then
        // surface the aggregate at the end.
        const errs: string[] = [];
        const note = (label: string, e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          errs.push(`${label}: ${msg}`);
          console.error(`[cron/reconcile] ${label} failed:`, e);
        };

        // Ensure the night's enqueued backfills are applied before categorize reads them
        // (the per-minute worker usually has by now; this is a safety drain).
        try { await drainSyncJobs(supabase, worker); } catch (e) { note("drain", e); }

        // Cashfree: poll each subscription's payments (recovers any charge a webhook never
        // delivered), then sweep a trailing window for late-settling fees.
        for (const c of cashfreeConnectors) {
          try {
            const res = await pollCashfreeSubscriptions(supabase, c, { deadlineMs: Date.now() + 20_000 });
            if (res.polled) console.log(`[cron/reconcile] cashfree subs polled=${res.polled} inserted=${res.inserted} updated=${res.updated} (${c.id})`);
          } catch (e) { note(`cashfree poll (${c.id})`, e); }
          try {
            const feeFrom = new Date(Date.now() - 75 * 86_400_000);
            const res = await reconcileCashfreeFees(supabase, c, { fromDate: feeFrom, toDate: now, deadlineMs: Date.now() + 45_000 });
            if (res.updated) { console.log(`[cron/reconcile] cashfree fees filled=${res.updated}/${res.feesSeen} (${c.id})`); invalidateOrg(c.org_id); }
          } catch (e) { note(`cashfree fees (${c.id})`, e); }
        }

        // Stripe/Razorpay: sync subscriptions + invoices for the current FY (idempotent).
        for (const c of subApiConnectors) {
          try {
            const res = await syncGatewaySubscriptions(supabase, c, { fromMs: fyStartMs, deadlineMs: Date.now() + 20_000 });
            if (res.fetched) console.log(`[cron/reconcile] ${c.type} subscriptions synced=${res.fetched} (${c.id})`);
          } catch (e) { note(`${c.type} subs (${c.id})`, e); }
          try {
            const inv = await syncGatewayInvoices(supabase, c, { fromMs: fyStartMs, deadlineMs: Date.now() + 20_000 });
            if (inv.fetched) console.log(`[cron/reconcile] ${c.type} invoices synced=${inv.fetched} (${c.id})`);
          } catch (e) { note(`${c.type} invoices (${c.id})`, e); }
        }

        // Tag any subscription charges now bridgeable via invoices (fill-only, idempotent).
        if (subApiConnectors.length) {
          try {
            const tagged = await tagSubscriptionCharges(supabase);
            if (tagged) console.log(`[cron/reconcile] tagged ${tagged} subscription charges from invoices`);
          } catch (e) { note("tag charges", e); }
        }

        // Auto-categorize newly-synced bank transactions (rules + AI if configured). Fill-only.
        for (const orgId of bankOrgIds) {
          try {
            const res = await categorizeBankTransactions(orgId, supabase);
            if (res.scanned) console.log(`[cron/reconcile] bank categorize org=${orgId} scanned=${res.scanned} system=${res.systemApplied} rule=${res.ruleApplied} ai=${res.aiApplied} remaining=${res.remaining}`);
            if (res.systemApplied + res.ruleApplied + res.aiApplied > 0) invalidateOrg(orgId);
          } catch (e) { note(`categorize (${orgId})`, e); }
        }

        // Surface aggregate failure: mark the whole run FAILED (Sync Health red) if any
        // phase errored — the fill-only work above still ran, but something didn't reconcile.
        if (errs.length) throw new Error(`${errs.length} reconcile phase error(s) — first: ${errs[0]}`);
      });
    } catch (err) {
      // recordCronRun already logged "failed"; never throw from a cron.
      console.error("[cron/reconcile] failed:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
