// ── Canonical dashboard page registry ───────────────────────────────────────
// Single source of truth for grantable pages. The Team modal's page-access list,
// the route-access gate (SLUG_ROUTES), and the fallback order all derive from this,
// so adding a page here makes it selectable everywhere — no more drift between the
// three lists. Pure data (no server/client imports) so both can use it.
//
// `pii: true` marks pages that expose raw customer/vendor PII (Subscriptions, Bank).
// They ARE grantable (the org owner decides per member), but flagged so the UI can
// warn when granting them.

export type PageDef = { slug: string; label: string; route: string; pii?: boolean };

export const GRANTABLE_PAGES: PageDef[] = [
  { slug: "dashboard",     label: "War Room",      route: "/dashboard" },
  { slug: "revenue",       label: "Revenue",       route: "/dashboard/revenue" },
  { slug: "cashflow",      label: "Cash Flow",     route: "/dashboard/cashflow" },
  { slug: "connectors",    label: "Connectors",    route: "/dashboard/connectors" },
  { slug: "data",          label: "Payments",      route: "/dashboard/data" },
  { slug: "subscriptions", label: "Subscriptions", route: "/dashboard/subscriptions", pii: true },
  { slug: "bank",          label: "Bank",          route: "/dashboard/bank", pii: true },
];

export const GRANTABLE_SLUGS = GRANTABLE_PAGES.map((p) => p.slug);
