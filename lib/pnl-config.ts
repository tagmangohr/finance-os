// Pure, dependency-free P&L config shared by server (lib/pnl.ts) and client
// components (P&L grid, Forecast). Kept separate so client bundles don't pull in
// lib/pnl.ts's server-only Supabase import.
//
// Contribution-margin tiers (SaaS default). Each tier subtracts its cost bucket
// from the tier above. '__pg_fees__' is the metadata.fee line; the rest are
// ledger_categories slugs.
export const CM_CONFIG: { id: string; label: string; cats: string[] }[] = [
  { id: "cm1", label: "CM1 · Gross Margin", cats: ["__pg_fees__", "ai_model", "cloud_infra", "technical_expense"] },
  { id: "cm2", label: "CM2 · Post-Marketing", cats: ["marketing"] },
  { id: "cm3", label: "CM3 · Post-People", cats: ["payroll", "contractors", "professional"] },
];

export const CM_CAT_ORDER = CM_CONFIG.flatMap((t) => t.cats).filter((c) => c !== "__pg_fees__");
