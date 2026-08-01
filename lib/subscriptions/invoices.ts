import type { createServiceClient } from "@/lib/supabase/server";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import type { Database, Json } from "@/lib/supabase/types";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Pick<Database["public"]["Tables"]["connectors"]["Row"], "id" | "org_id" | "type" | "config">;
type InvoiceRow = Database["public"]["Tables"]["gateway_invoices"]["Insert"];
type SyncOpts = { fromMs: number; deadlineMs: number; cursor?: string | null };
type InvSyncResult = { fetched: number; cursor: string | null; hasMore: boolean };

const iso = (sec?: number | null): string | null => (sec != null ? new Date(sec * 1000).toISOString() : null);

async function upsertInvoices(supabase: ServiceClient, rows: InvoiceRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from("gateway_invoices").upsert(rows, { onConflict: "gateway,invoice_id" });
  if (error) console.error("[invoices] upsert failed:", error.message);
}

/**
 * Sync Stripe invoices (the charge↔subscription bridge). Each invoice carries
 * `charge` (→ transactions.external_id), `subscription`, `billing_reason`
 * (subscription_create = new / subscription_cycle = renewal), tax and customer.
 */
export async function syncStripeInvoices(supabase: ServiceClient, connector: ConnectorRow, opts: SyncOpts): Promise<InvSyncResult> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.secret_key) return { fetched: 0, cursor: null, hasMore: false };
  const fromSec = Math.floor(opts.fromMs / 1000);
  let after: string | null = opts.cursor ?? null, fetched = 0;
  do {
    const u = new URL("https://api.stripe.com/v1/invoices");
    u.searchParams.set("limit", "100");
    u.searchParams.set("created[gte]", String(fromSec));
    if (after) u.searchParams.set("starting_after", after);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${cfg.secret_key}` }, next: { revalidate: 0 } });
    if (!res.ok) { console.error(`[invoices/stripe] ${res.status}: ${(await res.text()).slice(0, 160)}`); break; }
    const j = (await res.json()) as { data?: Array<Record<string, unknown>>; has_more?: boolean };
    const rows = j.data ?? [];
    const out: InvoiceRow[] = rows.map((inv) => {
      const cur = (inv.currency as string | undefined)?.toUpperCase() ?? null;
      const amt = inv.amount_paid != null ? (inv.amount_paid as number) / 100 : null;
      const disc = Array.isArray(inv.total_discount_amounts)
        ? (inv.total_discount_amounts as Array<{ amount?: number }>).reduce((s, d) => s + (d.amount ?? 0), 0) / 100
        : null;
      return {
        org_id: connector.org_id, connector_id: connector.id, gateway: "stripe", invoice_id: inv.id as string,
        subscription_id: (inv.subscription as string | null) ?? null,
        charge_external_id: (inv.charge as string | null) ?? null,
        customer_gateway_id: (inv.customer as string | null) ?? null,
        customer_name: (inv.customer_name as string | null) ?? null,
        customer_email: (inv.customer_email as string | null) ?? null,
        status: (inv.status as string | null) ?? null,
        native_status: (inv.status as string | null) ?? null,
        billing_reason: (inv.billing_reason as string | null) ?? null,
        amount: amt, currency: cur, amount_base: cur === "INR" ? amt : null,
        tax: inv.tax != null ? (inv.tax as number) / 100 : null,
        discount: disc,
        invoice_date: iso(inv.created as number | null),
        period_start: iso(inv.period_start as number | null),
        period_end: iso(inv.period_end as number | null),
        raw: inv as Json,
      };
    });
    await upsertInvoices(supabase, out);
    fetched += out.length;
    after = j.has_more && rows.length ? (rows[rows.length - 1].id as string) : null;
  } while (after && Date.now() < opts.deadlineMs);
  return { fetched, cursor: after, hasMore: after !== null };
}

/** Sync Razorpay invoices. invoice.payment_id → transactions.external_id (pay_…);
 *  invoice.subscription_id → the subscription. */
export async function syncRazorpayInvoices(supabase: ServiceClient, connector: ConnectorRow, opts: SyncOpts): Promise<InvSyncResult> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.key_id || !cfg.key_secret) return { fetched: 0, cursor: null, hasMore: false };
  const auth = "Basic " + Buffer.from(`${cfg.key_id}:${cfg.key_secret}`).toString("base64");
  let skip = Number(opts.cursor ?? 0) || 0, fetched = 0, hasMore = true;
  while (Date.now() < opts.deadlineMs) {
    const res = await fetch(`https://api.razorpay.com/v1/invoices?count=100&skip=${skip}`, { headers: { Authorization: auth }, next: { revalidate: 0 } });
    if (!res.ok) { console.error(`[invoices/razorpay] ${res.status}`); break; }
    const j = (await res.json()) as { items?: Array<Record<string, unknown>> };
    const items = j.items ?? [];
    if (!items.length) { hasMore = false; break; }
    const out: InvoiceRow[] = items
      .filter((inv) => (inv.created_at as number | undefined) == null || (inv.created_at as number) * 1000 >= opts.fromMs)
      .map((inv) => {
        const cd = (inv.customer_details ?? {}) as { name?: string; email?: string; contact?: string };
        const cur = (inv.currency as string | undefined)?.toUpperCase() ?? null;
        const amt = inv.amount_paid != null ? (inv.amount_paid as number) / 100 : null;
        return {
          org_id: connector.org_id, connector_id: connector.id, gateway: "razorpay", invoice_id: inv.id as string,
          subscription_id: (inv.subscription_id as string | null) ?? null,
          charge_external_id: (inv.payment_id as string | null) ?? null,
          customer_gateway_id: (inv.customer_id as string | null) ?? null,
          customer_name: cd.name ?? null, customer_email: cd.email ?? null, customer_phone: cd.contact ?? null,
          status: (inv.status as string | null) ?? null, native_status: (inv.status as string | null) ?? null,
          amount: amt, currency: cur, amount_base: cur === "INR" ? amt : null,
          tax: inv.tax_amount != null ? (inv.tax_amount as number) / 100 : null,
          invoice_date: iso(inv.issued_at as number | null) ?? iso(inv.created_at as number | null),
          raw: inv as Json,
        };
      });
    await upsertInvoices(supabase, out);
    fetched += out.length;
    skip += 100;
    if (items.length < 100) { hasMore = false; break; }
  }
  return { fetched, cursor: hasMore ? String(skip) : null, hasMore };
}

export async function syncGatewayInvoices(supabase: ServiceClient, connector: ConnectorRow, opts: SyncOpts): Promise<InvSyncResult> {
  if (connector.type === "stripe") return syncStripeInvoices(supabase, connector, opts);
  if (connector.type === "razorpay") return syncRazorpayInvoices(supabase, connector, opts);
  return { fetched: 0, cursor: null, hasMore: false };
}

/** Tag subscription charges in `transactions` from gateway_invoices, in one indexed
 *  DB statement (see migration 034). Fill-only + idempotent. Returns rows tagged. */
export async function tagSubscriptionCharges(supabase: ServiceClient): Promise<number> {
  const { data, error } = await supabase.rpc("tag_subscription_charges");
  if (error) { console.error("[invoices] tag rpc failed:", error.message); return 0; }
  return (data as number) ?? 0;
}
