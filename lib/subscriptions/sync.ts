import type { createServiceClient } from "@/lib/supabase/server";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import type { Database } from "@/lib/supabase/types";
import { persistSubscriptionResult } from "./persist";
import { stripeSubscriptionAdapter } from "./adapters/stripe";
import { razorpaySubscriptionAdapter } from "./adapters/razorpay";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Pick<Database["public"]["Tables"]["connectors"]["Row"], "id" | "org_id" | "type" | "config">;

// `cursor` makes the sync RESUMABLE across worker passes (for large historical
// backfills): pass the previous pass's returned cursor to continue. Return
// hasMore=true + a cursor when the deadline cut the run short.
type SyncOpts = { fromMs: number; deadlineMs: number; cursor?: string | null };
type SyncResult = { fetched: number; cursor: string | null; hasMore: boolean };

/**
 * Backfill/refresh Stripe subscriptions via the listable Subscriptions API. Expands
 * customer + price.product so each row carries plan + customer inline. Paginated
 * (starting_after), bounded by `deadlineMs`. Idempotent (upsert on gateway,sub_id).
 * Decrypts the connector secret — runs where CONNECTOR_ENC_KEY matches (prod).
 */
export async function syncStripeSubscriptions(supabase: ServiceClient, connector: ConnectorRow, opts: SyncOpts): Promise<SyncResult> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.secret_key) return { fetched: 0, cursor: null, hasMore: false };
  const fromSec = Math.floor(opts.fromMs / 1000);
  let startingAfter: string | null = opts.cursor ?? null;
  let fetched = 0;
  do {
    const url = new URL("https://api.stripe.com/v1/subscriptions");
    url.searchParams.set("status", "all");
    url.searchParams.set("limit", "100");
    url.searchParams.set("created[gte]", String(fromSec));
    // Expand customer only. items[].price is included by default; product would be a
    // 5th expand level (exceeds Stripe's max-4 limit and 400s the whole request), so
    // plan_name falls back to price.nickname / product id (enrich names separately).
    url.searchParams.append("expand[]", "data.customer");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${cfg.secret_key}` }, next: { revalidate: 0 } });
    if (!res.ok) { console.error(`[subs/stripe] list ${res.status}: ${(await res.text()).slice(0, 160)}`); break; }
    const j = (await res.json()) as { data?: Array<{ id: string }>; has_more?: boolean };
    const rows = j.data ?? [];
    for (const s of rows) { await persistSubscriptionResult(supabase, connector.org_id, connector.id, stripeSubscriptionAdapter(s)); fetched++; }
    startingAfter = j.has_more && rows.length ? rows[rows.length - 1].id : null;
  } while (startingAfter && Date.now() < opts.deadlineMs);
  return { fetched, cursor: startingAfter, hasMore: startingAfter !== null };
}

/**
 * Backfill/refresh Razorpay subscriptions. The subscription only references
 * plan_id/customer_id, so we fetch + cache plan and customer per id. Paginated
 * (count/skip), FY-filtered on start_at, bounded by deadline.
 */
export async function syncRazorpaySubscriptions(supabase: ServiceClient, connector: ConnectorRow, opts: SyncOpts): Promise<SyncResult> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.key_id || !cfg.key_secret) return { fetched: 0, cursor: null, hasMore: false };
  const auth = "Basic " + Buffer.from(`${cfg.key_id}:${cfg.key_secret}`).toString("base64");
  const base = "https://api.razorpay.com/v1";
  const planCache = new Map<string, unknown>();
  const custCache = new Map<string, unknown>();
  const fetchJson = async (path: string) => { const r = await fetch(`${base}${path}`, { headers: { Authorization: auth }, next: { revalidate: 0 } }); return r.ok ? r.json() : null; };
  const getPlan = async (id?: string) => { if (!id) return null; if (planCache.has(id)) return planCache.get(id); const p = await fetchJson(`/plans/${id}`); planCache.set(id, p); return p; };
  const getCust = async (id?: string) => { if (!id) return null; if (custCache.has(id)) return custCache.get(id); const c = await fetchJson(`/customers/${id}`); custCache.set(id, c); return c; };

  let skip = Number(opts.cursor ?? 0) || 0, fetched = 0, hasMore = true;
  while (Date.now() < opts.deadlineMs) {
    const j = (await fetchJson(`/subscriptions?count=100&skip=${skip}`)) as { items?: Array<Record<string, unknown>> } | null;
    const items = j?.items ?? [];
    if (!items.length) { hasMore = false; break; }
    for (const sub of items) {
      const startAt = sub.start_at as number | undefined;
      if (startAt != null && startAt * 1000 < opts.fromMs) continue; // outside window
      const plan = (await getPlan(sub.plan_id as string | undefined)) as { item?: unknown; period?: string; interval?: number } | null;
      const customer = (await getCust(sub.customer_id as string | undefined)) as { name?: string; email?: string; contact?: string } | null;
      await persistSubscriptionResult(supabase, connector.org_id, connector.id, razorpaySubscriptionAdapter(sub as never, { plan: plan as never, customer: customer as never }));
      fetched++;
    }
    skip += 100;
    if (items.length < 100) { hasMore = false; break; }
  }
  return { fetched, cursor: hasMore ? String(skip) : null, hasMore };
}

/** Dispatch to the right gateway sync. No-op for gateways without a pull API. */
export async function syncGatewaySubscriptions(supabase: ServiceClient, connector: ConnectorRow, opts: SyncOpts): Promise<SyncResult> {
  if (connector.type === "stripe") return syncStripeSubscriptions(supabase, connector, opts);
  if (connector.type === "razorpay") return syncRazorpaySubscriptions(supabase, connector, opts);
  return { fetched: 0, cursor: null, hasMore: false };
}
