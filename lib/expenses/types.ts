// Shared types for the bank-expense categorization layer.

export type Treatment = "expense" | "income" | "excluded" | "uncategorized";

export type LedgerCategory = {
  slug: string;
  label: string;
  treatment: Treatment;
  flow: "in" | "out" | "both";
  sort: number;
  is_system: boolean;
  org_id: string | null;
};

export type CategoryRule = {
  id: string;
  org_id: string | null;
  match_field: "counterparty" | "description" | "source";
  match_type: "exact" | "contains";
  match_value: string;
  // Optional COUNTERPARTY scope. When set, the rule matches ONLY rows whose
  // counterparty_name also equals this (exact, case-insensitive) — so a rule
  // remembered for a specific merchant can't leak onto a different merchant that
  // happens to share the same (often generic) description. NULL = unscoped (legacy
  // description/counterparty rules keep their original single-field behaviour).
  match_counterparty: string | null;
  category_slug: string;
  priority: number;
  source: "seed" | "manual";
};

export type CategorySource = "manual" | "rule" | "ai" | "system";
