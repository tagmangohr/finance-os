import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { CashfreeConnector } from "@/lib/connectors/cashfree";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { reconcileCashfreePayments } from "@/lib/connectors/cashfree-payments";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

/**
 * POST /api/admin/cashfree-backfill   Authorization: Bearer <CRON_SECRET>
 * Body (all optional): { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", org_id?, cursor_from? }
 *
 * ONE-TIME historical restatement: sweeps the Cashfree settlement-recon feed over the
 * whole date range and heals payments through the SAME code path the nightly reconcile
 * uses (reconcileCashfreePayments) — inserting settled payments Cashfree never
 * webhooked us, and flipping enrollment-failed-but-settled charges to completed.
 *
 * Resumable + bounded: processes 10-day windows until ~270s, then returns `nextFrom`.
 * Call again with { cursor_from: nextFrom } until `done: true`. Idempotent (keyed on
 * cf_pay_<id>) so re-running a window costs nothing. AFTER it reports done, rebuild the
 * rollups (GET /api/cron/snapshot, or rebuild_all_rollups) so gross/P&L/dashboard
 * restate from the healed ledger.
 */
export const maxDuration = 300;
const WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    from?: string; to?: string; org_id?: string; cursor_from?: string;
  };
  const from = body.from ?? "2025-11-25";
  const to = body.to ?? new Date().toISOString().slice(0, 10);
  const cursorFrom = body.cursor_from ?? from;

  const supabase = await createServiceClient();
  let q = supabase.from("connectors").select("*").eq("type", "cashfree").eq("status", "active");
  if (body.org_id) q = q.eq("org_id", body.org_id);
  const { data: conns, error: connErr } = await q;
  if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });
  if (!conns || conns.length === 0) return NextResponse.json({ message: "No active Cashfree connectors", done: true });

  const startedAt = Date.now();
  // Stop STARTING new windows after 150s, and give each started window up to 120s of its
  // own. Worst case a window starts at ~150s and runs to ~270s — comfortably inside the
  // 300s maxDuration, so the function always returns a `nextFrom` instead of being killed.
  const stopStartingMs = startedAt + 150_000;
  const end = Date.parse(`${to}T23:59:59+05:30`);
  const asDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  let totalInserted = 0, totalHealed = 0, windows = 0;
  // Advance ONLY after a window fully completes, so an interrupted/partial window is
  // re-done (idempotently) on the next call rather than silently skipped.
  let cursorMs = Date.parse(`${cursorFrom}T00:00:00+05:30`);
  const detail: Array<{ window: string; inserted: number; healed: number }> = [];

  while (cursorMs < end) {
    if (Date.now() > stopStartingMs) break;
    const a = new Date(cursorMs);
    const b = new Date(Math.min(cursorMs + WINDOW_MS, end));
    const windowDeadline = Date.now() + 120_000;
    let winInserted = 0, winHealed = 0;
    for (const c of conns as ConnectorRow[]) {
      const cfg = decryptConfigSecrets((c.config ?? {}) as Record<string, string>);
      if (!cfg.client_id || !cfg.client_secret) continue;
      const rawEvents = await new CashfreeConnector(cfg.client_id, cfg.client_secret).fetchReconRaw(a, b, { deadlineMs: windowDeadline });
      const res = await reconcileCashfreePayments(supabase, c, { fromDate: a, toDate: b, deadlineMs: windowDeadline, rawEvents });
      winInserted += res.inserted; winHealed += res.healed;
    }
    totalInserted += winInserted; totalHealed += winHealed; windows++;
    detail.push({ window: `${a.toISOString().slice(0, 10)}..${b.toISOString().slice(0, 10)}`, inserted: winInserted, healed: winHealed });
    cursorMs += WINDOW_MS; // window complete → safe to advance
  }

  const done = cursorMs >= end;
  return NextResponse.json({
    from, to, cursorFrom, windows, inserted: totalInserted, healed: totalHealed,
    nextFrom: done ? null : asDate(cursorMs), done, detail,
  });
}
