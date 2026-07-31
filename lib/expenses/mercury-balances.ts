import type { SupabaseClient } from "@supabase/supabase-js";
import { MercuryConnector } from "@/lib/connectors/mercury";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { getInrRates } from "@/lib/fx/rates";

type ConnectorLike = { id: string; org_id: string; config: Record<string, unknown> | null };

// Kinds that count as available cash; credit is a liability (subtracted).
const CASH_KINDS = new Set(["checking", "savings", "treasury"]);

/**
 * Refresh the stored per-account balances for a Mercury connector from the live
 * /accounts endpoint. Idempotent upsert keyed on (connector_id, account_id).
 * Balances are USD → also stored in INR (current_balance_base) at the latest rate.
 * Never throws fatally to the caller's flow — returns 0 on any failure.
 */
export async function refreshMercuryBalances(supabase: SupabaseClient, connector: ConnectorLike): Promise<number> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  const apiToken = cfg.api_token;
  if (!apiToken) return 0;

  let accounts;
  try {
    accounts = await new MercuryConnector(apiToken).fetchAccounts();
  } catch (e) {
    console.error("[mercury-balances] fetchAccounts failed:", e);
    return 0;
  }

  // Latest available USD→INR rate (ECB may lag today, so look back a few days).
  const days: string[] = [];
  for (let i = 0; i < 6; i++) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  let usdInr: number | null = null;
  try {
    const rates = await getInrRates("USD", days);
    for (const d of days) { const r = rates.get(d); if (r) { usdInr = r; break; } }
  } catch { /* leave base null if FX unavailable */ }

  let n = 0;
  for (const acc of accounts) {
    // Only Mercury-owned accounts carry a real balance (external/recipient don't).
    if (acc.type && acc.type !== "mercury") continue;
    const currency = (acc.currency ?? "USD").toUpperCase();
    const current = acc.currentBalance ?? null;
    const base =
      current == null ? null : currency === "INR" ? current : usdInr != null ? current * usdInr : null;
    const { error } = await supabase
      .from("bank_account_balances")
      .upsert(
        {
          org_id: connector.org_id,
          connector_id: connector.id,
          account_id: acc.id,
          account_name: acc.nickname ?? acc.name ?? null,
          kind: acc.kind ?? null,
          currency,
          current_balance: current,
          available_balance: acc.availableBalance ?? null,
          current_balance_base: base,
          raw: acc as unknown as import("@/lib/supabase/types").Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connector_id,account_id" }
      );
    if (!error) n += 1;
  }
  return n;
}

export type CashPosition = { cashBase: number; hasData: boolean; byKind: Record<string, number> };

/**
 * True cash position from stored Mercury balances (INR): checking + savings +
 * treasury, minus credit-card outstanding. Returns hasData=false if no balances
 * are stored yet (caller falls back to its transaction-derived proxy).
 */
export async function getMercuryCashPosition(orgId: string, supabase: SupabaseClient): Promise<CashPosition> {
  const { data } = await supabase
    .from("bank_account_balances")
    .select("kind, current_balance_base")
    .eq("org_id", orgId);
  const rows = (data ?? []) as { kind: string | null; current_balance_base: number | null }[];
  const byKind: Record<string, number> = {};
  let cashBase = 0;
  for (const r of rows) {
    const kind = (r.kind ?? "unknown").toLowerCase();
    const v = Number(r.current_balance_base ?? 0);
    byKind[kind] = (byKind[kind] ?? 0) + v;
    if (CASH_KINDS.has(kind)) cashBase += v;
    else if (kind === "credit") cashBase -= v; // outstanding card balance is a liability
  }
  return { cashBase, hasData: rows.length > 0, byKind };
}
