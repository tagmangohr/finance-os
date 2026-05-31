# Finance OS — Full Code Handoff

## What is this

Finance OS is a founder-grade financial intelligence dashboard. It connects to payment gateways and accounting tools, normalises all transaction data into a single schema, runs 9 intelligence primitives (runway, burn, ARR, collections, anomalies, etc.), and lets a founder ask plain-English questions via a Claude-powered AI chat.

**Live URL:** Deployed on Vercel (check Vercel dashboard for exact URL)  
**GitHub:** `https://github.com/tagmangohr/finance-os`  
**Branch:** `main`

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Database | Supabase (Postgres 15) |
| Auth | Supabase Auth (email/password) |
| AI | Anthropic Claude (`claude-sonnet-4-5`) |
| Styling | Tailwind CSS 3 + shadcn/ui (Radix primitives) |
| Charts | Recharts |
| Deployment | Vercel |
| Middleware | `proxy.ts` at project root (Next.js 16 convention) |

> **Important:** Next.js 16 uses `proxy.ts` (not `middleware.ts`). The function must be named `proxy`, not `middleware`. Never create `middleware.ts`.

> **Important:** Always run dev/build with `--webpack` flag:  
> `next dev --webpack` / `next build --webpack`  
> Turbopack crashes on this project.

---

## Local Setup

```bash
# 1. Clone
git clone https://github.com/tagmangohr/finance-os.git
cd finance-os

# 2. Install
npm install

# 3. Environment variables — create .env.local (see section below)

# 4. Run dev
/usr/local/bin/npx next dev --webpack
# App runs on http://localhost:3001
```

---

## Environment Variables

Create `.env.local` at the project root with these keys:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=         # from Supabase project settings
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # from Supabase project settings → API
SUPABASE_SERVICE_ROLE_KEY=        # from Supabase project settings → API (secret)

# Anthropic (Claude AI)
ANTHROPIC_API_KEY=                # from console.anthropic.com

# Razorpay (for webhook verification only — actual credentials stored per-connector in DB)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3001   # or https://your-domain.vercel.app
```

> The `SUPABASE_SERVICE_ROLE_KEY` is used only in server-side API routes via `createServiceClient()`. It bypasses RLS — never expose it to the client.

---

## Database

**Supabase Project:** Check `.env.local` for the project URL.

### Apply Migrations

All migrations are in `supabase/migrations/`. Run them in order in the **Supabase Dashboard → SQL Editor**:

| File | What it creates |
|---|---|
| `001_organizations.sql` | `organizations` table |
| `002_connectors.sql` | `connectors` table + `connector_type` ENUM |
| `003_entities.sql` | `entities` table (customers/vendors) |
| `004_transactions.sql` | `transactions` table |
| `005_invoices.sql` | `invoices` table |
| `006_financial_snapshots.sql` | `financial_snapshots` table |
| `007_intelligence_alerts.sql` | `intelligence_alerts` table |
| `008_views.sql` | Helper views (monthly revenue, etc.) |
| `009_new_connectors.sql` | Adds `cashfree`, `payu`, `paytm`, `easebuzz` to the `connector_type` ENUM |

> Migration 009 must be run separately if the DB was set up before the new connectors were added.

### Schema Overview

```
organizations       — one per user (org_id is the root key for all data)
connectors          — payment gateway accounts (per org, multiple per type)
transactions        — normalised transactions from all sources
entities            — customers and vendors (aggregated from transactions)
invoices            — invoice records (from Zoho/QuickBooks or manual)
financial_snapshots — daily snapshots computed by the intelligence layer
intelligence_alerts — generated alerts (runway warning, burn spike, etc.)
```

---

## Project Structure

```
finance-os/
├── app/
│   ├── api/
│   │   ├── connectors/
│   │   │   ├── razorpay/route.ts     — sync endpoint
│   │   │   ├── stripe/route.ts
│   │   │   ├── cashfree/route.ts
│   │   │   ├── payu/route.ts
│   │   │   ├── paytm/route.ts
│   │   │   ├── easebuzz/route.ts
│   │   │   ├── csv/route.ts          — CSV/Excel import
│   │   │   └── manage/route.ts       — CRUD for connector records
│   │   ├── intelligence/route.ts     — Claude AI chat endpoint
│   │   ├── sync/route.ts             — global sync (all connectors)
│   │   ├── transactions/route.ts     — transaction list/filter
│   │   └── webhooks/
│   │       ├── razorpay/route.ts
│   │       └── stripe/route.ts
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── callback/route.ts         — Supabase OAuth callback
│   ├── dashboard/
│   │   ├── layout.tsx                — sidebar + topbar shell
│   │   ├── page.tsx                  — War Room (main dashboard)
│   │   ├── revenue/page.tsx
│   │   ├── cashflow/page.tsx
│   │   ├── collections/page.tsx
│   │   ├── intelligence/page.tsx     — AI chat
│   │   ├── connectors/
│   │   │   ├── page.tsx              — server component (fetches connectors)
│   │   │   └── connectors-client.tsx — all connector UI logic
│   │   └── data/page.tsx             — raw transaction explorer
│   └── onboarding/page.tsx
│
├── components/
│   ├── charts/
│   │   ├── revenue-chart.tsx         — BarChart (Recharts)
│   │   ├── cashflow-chart.tsx        — ComposedChart (Area + Line)
│   │   └── category-chart.tsx        — Horizontal bar chart
│   ├── dashboard/
│   │   ├── runway-card.tsx           — SVG ring + gradient text
│   │   ├── metric-card.tsx
│   │   ├── top-bar.tsx
│   │   ├── sidebar-nav.tsx
│   │   ├── ticker.tsx                — scrolling metrics strip
│   │   ├── co-pilot.tsx              — slide-out AI rail
│   │   ├── command-palette.tsx       — ⌘K search
│   │   └── alert-banner.tsx
│   └── ui/                           — shadcn/Radix base components
│
├── lib/
│   ├── connectors/
│   │   ├── razorpay.ts               — RazorpayConnector class
│   │   ├── stripe.ts                 — StripeConnector class
│   │   ├── cashfree.ts               — CashfreeConnector class
│   │   ├── payu.ts                   — PayUConnector class
│   │   ├── paytm.ts                  — PaytmConnector class
│   │   ├── easebuzz.ts               — EasebuzzConnector class
│   │   └── csv-parser.ts
│   ├── intelligence/
│   │   ├── index.ts                  — orchestrator (runs all 9 in parallel)
│   │   ├── runway.ts
│   │   ├── burn-rate.ts
│   │   ├── revenue.ts
│   │   ├── collections.ts
│   │   ├── concentration.ts
│   │   ├── cashflow.ts
│   │   ├── anomalies.ts
│   │   ├── tax-position.ts
│   │   ├── forecast.ts
│   │   ├── claude.ts                 — Claude API chat handler
│   │   └── types.ts
│   ├── normalizer/index.ts           — raw API types → NormalizedTransaction
│   ├── db/dedup.ts                   — batched external_id dedup helper
│   ├── data.ts                       — server-side data fetchers for pages
│   ├── supabase/
│   │   ├── client.ts                 — browser client
│   │   ├── server.ts                 — server client + service client
│   │   └── types.ts                  — generated DB types
│   └── utils.ts                      — formatCurrency, formatDate, cn()
│
├── proxy.ts                          — Next.js 16 auth middleware
└── supabase/migrations/              — SQL migration files
```

---

## Connector Architecture

Each payment gateway follows a strict 3-layer pattern:

### Layer 1 — Connector class (`lib/connectors/<name>.ts`)
Handles API authentication and pagination. Returns `NormalizedTransaction[]`.

```typescript
// Auth patterns per gateway:
// Razorpay  → Basic Auth (key_id:key_secret)
// Stripe    → Bearer token (secret_key)
// Cashfree  → x-client-id + x-client-secret headers
// PayU      → HMAC-SHA512 hash in POST body (key|command|var1|salt)
// Paytm     → HMAC-SHA256 base64 in head.signature JSON
// Easebuzz  → SHA512 hash in POST form body (key|salt)
```

### Layer 2 — Normalizer (`lib/normalizer/index.ts`)
Converts every gateway's raw response type to `NormalizedTransaction`:
```typescript
type NormalizedTransaction = {
  external_id: string;          // e.g. "rzp_pay_xxx", "cf_order_xxx"
  type: "credit" | "debit";
  amount: number;               // always full currency units (INR, USD)
  currency: string;
  category: string | null;
  counterparty_name: string | null;
  description: string | null;
  source: string;               // e.g. "razorpay", "cashfree_settlement"
  status: "pending"|"completed"|"failed"|"refunded";
  transaction_date: string;     // ISO string
  metadata: Record<string, unknown>;
}
```

### Layer 3 — API route (`app/api/connectors/<name>/route.ts`)
- Reads connector config from DB
- Calls the connector class
- Deduplicates via `getExistingExternalIds()` (batched, 500 IDs/call)
- Inserts new rows into `transactions`
- Updates `last_synced_at` on the connector record

**Sync is triggered from the UI via `POST /api/connectors/<name>` with:**
```json
{
  "connector_id": "uuid",
  "org_id": "uuid",
  "from_date": "2024-01-01T00:00:00.000Z",   // optional
  "to_date":   "2024-12-31T23:59:59.000Z"    // optional
}
```
Default range when omitted: last 30 days.

### Chunked sync (UI-side)
The Sync button dropdown splits any date range into 30-day chunks and fires them sequentially to avoid Vercel function timeouts. Each chunk is a separate API call. Progress is shown live in the UI as `N/M`.

---

## Intelligence Layer

`lib/intelligence/index.ts` runs 9 functions in parallel via `Promise.all`:

| Function | What it computes |
|---|---|
| `calculateRunway` | Cash / monthly burn = days of runway |
| `calculateBurnRate` | 3-month rolling average monthly spend |
| `calculateRevenue` | MRR, ARR, MoM growth, top customers |
| `calculateCollections` | Overdue invoices, aging buckets, collection rate |
| `calculateConcentration` | Top customer revenue %, concentration risk |
| `calculateCashFlow` | Monthly inflow/outflow/net, P&L table |
| `detectAnomalies` | Unusual spikes vs 3-month baseline |
| `calculateTaxPosition` | GST liability estimate from revenue |
| `generateForecast` | 3-month revenue projection (linear regression) |

Results are saved to `financial_snapshots` and `intelligence_alerts`.

### Claude AI chat (`app/api/intelligence/route.ts`)
- Runs all 9 intelligence functions → builds a structured context object
- Passes it as a system prompt to `claude-sonnet-4-5`
- Streams the answer back
- Supports multi-turn conversation history

---

## Auth Flow

1. User visits any protected route → `proxy.ts` checks session → redirects to `/auth/login` if unauthenticated
2. Login → Supabase sets session cookie → redirect to `/dashboard`
3. If authenticated but no org record → redirect to `/onboarding`
4. Onboarding creates `organizations` row → redirect to `/dashboard`

**Demo account:** `demo@financeos.app` / `Demo@12345`

---

## Key Design Decisions

### Dark terminal UI
Design token system:
- Background: `hsl(220 40% 7%)` — dark navy
- Primary: `#7c52f0` — violet
- Success: `#1db884` — emerald
- Warning: `#f59116` — amber
- Danger: `#e83a3a` — red
- `.num` class: `font-variant-numeric: tabular-nums` for financial figures

### Connector modal
- Radix `Dialog` with z-index `z-[200]`/`z-[201]` (overrides the co-pilot rail)
- Draggable via `mousedown` on header + `mousemove` on `window`
- Centered using `inset: 0; margin: auto` (not `transform: translate`) because `animate-scale-in` uses `fill-mode: both` with `transform: scale()` which would overwrite a transform-based centering
- 3-zone layout: sticky header / scrollable body / sticky footer — no content ever clips off screen

### Dedup strategy
`getExistingExternalIds()` in `lib/db/dedup.ts` queries in batches of 500. Every sync checks `external_id` at org level (not connector level) to prevent cross-connector duplicates if the same transaction appears in multiple sources.

---

## What's Complete

- [x] Auth (login, onboarding, session management)
- [x] Organizations (single-tenant, one org per user)
- [x] All 9 intelligence primitives
- [x] Claude AI chat with full financial context
- [x] War Room dashboard (runway ring, MRR, burn, ARR, net burn, alerts, debtors, revenue chart)
- [x] Revenue page (MoM trend, customer concentration, category breakdown)
- [x] Cash Flow page (area chart, monthly P&L table)
- [x] Collections page (debtor table, aging buckets, overdue invoices)
- [x] Raw Data explorer
- [x] Connectors: Razorpay, Stripe, Cashfree, PayU, Paytm, Easebuzz
- [x] Connectors: CSV/Excel upload + Bank Statement upload
- [x] Multi-account per connector type
- [x] Sync with preset date ranges (30d / 90d / 6mo / 1yr / 2yr / 3yr)
- [x] Custom date range picker with live chunk estimate
- [x] Chunked historical sync (30-day windows, sequential)
- [x] Razorpay + Stripe webhooks
- [x] Terminal dark UI with ticker, co-pilot rail, ⌘K command palette
- [x] Mobile-responsive sidebar

---

## What's Not Built Yet (natural next steps)

| Feature | Notes |
|---|---|
| Zoho Books sync | OAuth flow needed; connector UI card exists |
| QuickBooks sync | OAuth flow needed; connector UI card exists |
| Tally sync | Local XML bridge needed; connector UI card exists |
| Multi-user orgs | Schema is single-tenant; would need `org_members` table + RLS |
| Email reminders | Collections page has "Remind" links that open the AI chat |
| PDF / CSV export | No export endpoint yet |
| Budget vs actual | No budget input screen |
| GST filing | Tax position is estimated, not filing-ready |
| Cron auto-sync | `app/api/cron/sync/route.ts` exists but needs Vercel cron config in `vercel.json` |
| Dark/light mode toggle | `next-themes` is installed; only dark mode is styled |

---

## Vercel Deployment

1. Push to `main` → Vercel auto-deploys
2. Add all `.env.local` variables to Vercel project → Settings → Environment Variables
3. Vercel function timeout: default 10s (Hobby), up to 60s (Pro)
   - Each sync chunk is a short call — no timeout risk
   - Intelligence route can take ~3–5s on cold start; Pro plan recommended

### Enable cron sync (optional)
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/sync",
    "schedule": "0 2 * * *"
  }]
}
```
This auto-syncs all active connectors at 2 AM daily.

---

## Running TypeScript Check

```bash
/usr/local/bin/npx tsc --noEmit
```
Zero errors as of the last commit.

---

## Git History (last 10 commits)

```
da956c0  feat: custom date range picker for sync
afb2900  feat: sync date-range picker with chunked historical sync
097f36f  fix: dialog centering broken by animate-scale-in transform conflict
125ca20  fix: draggable dialog, sticky footer, logo fallbacks
2c85833  feat: replace emoji icons with real brand logos on connector cards
2fb1903  feat: normalizers, types, and migration for new connectors
b0bcf6d  feat: add Cashfree, PayU, Paytm, Easebuzz connectors
f1e4e14  feat: Terminal redesign — full dark-navy UI overhaul
7664561  fix: connector delete, masked key ID per account
c2f230f  fix: global dedup, data cleanup, connector edit mode
```
