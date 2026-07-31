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
  category_slug: string;
  priority: number;
  source: "seed" | "manual";
};

export type CategorySource = "manual" | "rule" | "ai" | "system";
