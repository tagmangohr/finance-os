# Finance OS — Complete Design Specification

## Overview
Finance OS is a dark-themed, intelligence-first financial dashboard for SaaS founders. The aesthetic is deep navy/midnight blue with a single violet-purple primary accent, inspired by Bloomberg Terminal meets Linear.app. Data density is high; visual noise is low.

---

## 1. Brand Identity

| Attribute | Value |
|-----------|-------|
| Product name | Finance OS |
| Logo mark | `TrendingUp` icon (Lucide) inside a rounded square |
| Tagline | "Intelligence layer for founders" |
| Voice | Terse, data-forward, zero fluff |
| Aesthetic | Bloomberg Terminal × Linear × Vercel Dashboard |

---

## 2. Color System

### CSS Custom Properties (HSL)
```css
/* Background layers */
--background:         222 47%  4%;    /* #060a14 — deepest navy */
--card:               220 40%  7%;    /* #0c1221 — card surface */
--popover:            220 38%  8%;    /* modal / dropdown */
--secondary:          220 30% 12%;    /* hover surfaces */
--muted:              220 30% 11%;    /* subtle fills */
--accent:             220 30% 13%;    /* highlighted fills */

/* Borders */
--border:             220 25% 13%;    /* default border */
--input:              220 30% 12%;    /* form input border */

/* Text */
--foreground:         220 20% 94%;    /* primary text */
--card-foreground:    220 20% 94%;
--muted-foreground:   220 15% 52%;    /* secondary text */

/* Brand accent */
--primary:            258 88% 66%;    /* #7c3aed-ish violet-purple */
--primary-foreground: 258 100% 98%;   /* near-white on primary */
--ring:               258 88% 66%;    /* focus ring = primary */

/* Semantic */
--success:            158 64% 48%;    /* #10b981 emerald-green */
--warning:            38  92% 56%;    /* #f59e0b amber */
--destructive:        0   72% 56%;    /* #ef4444 red */

/* Charts (5 palette) */
--chart-1:            258 88% 66%;    /* violet   (primary) */
--chart-2:            158 64% 48%;    /* emerald  */
--chart-3:            38  92% 56%;    /* amber    */
--chart-4:            199 89% 54%;    /* sky-blue */
--chart-5:            330 81% 62%;    /* rose-pink */

/* Radius */
--radius: 0.75rem;   /* 12px — all rounded-xl / rounded-2xl */
```

### Opacity Scale for White Text
| Usage | Class | Opacity |
|-------|-------|---------|
| Primary headings | `text-white/90` | 90% |
| Body text | `text-white/70` | 70% |
| Secondary labels | `text-white/50` | 50% |
| Tertiary / captions | `text-white/30` | 30% |
| Placeholder / subtle | `text-white/20` | 20% |
| Ghost / decorative | `text-white/10` | 10% |

### Named Color Hex References
| Token | Hex |
|-------|-----|
| Background | `#060a14` |
| Card | `#0c1221` |
| Sidebar | `#060a14` |
| Primary (violet) | `hsl(258 88% 66%)` ≈ `#7c52f0` |
| Success (emerald) | `hsl(158 64% 48%)` ≈ `#1db884` |
| Warning (amber) | `hsl(38 92% 56%)` ≈ `#f59116` |
| Destructive (red) | `hsl(0 72% 56%)` ≈ `#e83a3a` |

---

## 3. Typography

### Font Stack
```
font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
font-smoothing: antialiased (webkit + moz)
font-feature-settings: "rlig" 1, "calt" 1
```

### Scale
| Role | Size | Weight | Class |
|------|------|--------|-------|
| Page title | 20px / 1.25rem | 700 | `text-xl font-bold` |
| Section heading | 14px | 600 | `text-sm font-semibold` |
| Card title | 13px | 600 | `text-[13px] font-semibold` |
| Body | 14px | 400 | `text-sm` |
| Small body | 12px | 400 | `text-xs` |
| Caption / label | 11px | 500 | `text-[11px] font-medium` |
| Micro label | 10px | 600 | `text-[10px] font-semibold uppercase tracking-[0.12em]` |
| Metric value | 28–36px | 700 | `text-3xl font-bold` |
| Sub-metric | 18px | 700 | `text-lg font-bold` |

### Financial Numbers
```css
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  letter-spacing: -0.02em;
}
```
All currency / percentage values use tabular numerics. Amounts use `formatCurrency()` with compact notation (₹1.2L, ₹4.5Cr).

---

## 4. Layout & Grid

### Shell
```
┌─────────────────────────────────────────────────────┐
│ Sidebar (240px / collapsed 64px)  │  Main content   │
│  sticky, full height              │  flex-col       │
│  bg: #060a14                      │                 │
│                                   │ TopBar (56px)   │
│                                   │─────────────────│
│                                   │ <main>          │
│                                   │ p-4 sm:p-6      │
│                                   │ overflow-y-auto │
└─────────────────────────────────────────────────────┘
```

### Sidebar (240px expanded, 64px collapsed)
- Background: `#060a14`
- Right border: `border-white/[0.05]`
- Logo zone: 64px tall, bottom border
- Nav items: 40px tall, `px-3 py-2.5 rounded-lg`
- Active item: `bg-primary/[0.12]` + left 3px bar `bg-primary` + glow dot
- Collapse toggle: floating `-right-3 top-20` circle button
- Footer: user avatar initial + email + sign-out

### TopBar (56px, sticky)
- Background: `#060a14/80` + `backdrop-blur-xl`
- Bottom border: `border-white/[0.05]`
- Left: page emoji + title + org name
- Right: Sync button + Notifications bell

### Content Area
- Max width: `max-w-[1400px]`
- Padding: `p-4 sm:p-6`
- Grid gaps: `gap-3` (12px) for tightly packed cards; `gap-4` (16px) for roomier sections
- Row entry animation: staggered `animate-enter` with 50ms delays per row

### Responsive Breakpoints
| Breakpoint | Behavior |
|------------|----------|
| `<lg` | Sidebar hidden; mobile drawer via `MobileSidebarWrapper` |
| `sm` | 2-column grid for metric cards |
| `lg` | 3-column grids; sidebar visible |

---

## 5. Component Library

### MetricCard
```
┌──────────────────────────────────┐
│ [Icon]    TITLE                  │
│           ───────────────────    │
│           ₹4.2L              ↑   │  ← big value + trend badge
│           +12.3% MoM            │
│           subtitle text         │
│           [sparkline if any]    │
└──────────────────────────────────┘
```
- Border: `border-border/60` → hover `border-border`
- Hover lift: `-translate-y-0.5`
- Severity variants: `good` = emerald icon; `warning` = amber; `critical` = red; `neutral` = white/20
- Trend badge: `↑ +12.3%` green / `↓ -5.1%` red, pill shape
- Sparkline: 100px wide Recharts LineChart, no axes, colored by severity

### RunwayCard (hero card, 2/3 width)
```
┌───────────────────────────────────────────────────┐
│ RUNWAY                              ██████░░ 70%   │
│ ────────────────────────────────────────────────  │
│   247 days          burn ₹8.5L/mo                 │
│   ~8.2 months       "Healthy — extend above 12m"  │
└───────────────────────────────────────────────────┘
```
- Severity ring: good=emerald, warning=amber, critical=red
- Progress bar fills left-to-right
- Large value: `text-5xl font-black`

### Card (generic container)
```tsx
<Card>  // rounded-2xl border bg-card p-5
  <CardHeader>
    <CardTitle>  // text-sm font-semibold text-white/70 uppercase tracking-[0.1em]
  </CardHeader>
  <CardContent>
```
- All cards: `rounded-2xl border border-border/60 bg-card`
- Hover: `border-border transition-all hover:-translate-y-0.5`
- Shadow: `shadow-[0_1px_3px_rgba(0,0,0,0.4)]`

### Alert / Intelligence Alert Row
```
┌────────────────────────────────────────┐
│ ● ALERT TITLE               severity  │  ← colored left dot
│   Alert message text here             │
└────────────────────────────────────────┘
```
- Critical: red dot + `border-red-500/20 bg-red-500/[0.04]`
- Warning: amber dot + `border-amber-400/20 bg-amber-400/[0.04]`
- Info: primary dot + `border-primary/20 bg-primary/[0.06]`

### Button variants
| Variant | Appearance |
|---------|-----------|
| `default` | `bg-primary text-primary-foreground` + violet glow on hover |
| `outline` | `border-white/[0.07] bg-transparent text-white/40` |
| `ghost` | transparent, `hover:bg-white/[0.04]` |
| `destructive` | `bg-destructive` |
| `link` | text only, primary color |
- Size `sm`: h-8, px-3, text-xs
- Size `default`: h-9, px-4, text-sm
- Border radius: 0.5rem (rounded-lg)

### Input
```
border-white/[0.08] bg-white/[0.03] text-white/80
placeholder:text-white/20
focus:border-primary/30 focus:ring-primary/20
rounded-lg h-9 px-3
```

### Badge
- Pill shape, `rounded-full text-xs px-2 py-0.5`
- Color variants matching semantic palette

### SyncModal (full-screen overlay)
- `bg-black/60 backdrop-blur-md`
- Inner: `bg-[#0c1221] border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)]`
- Progress rows per connector: name + type badge + inserted count + warning/error state

---

## 6. Chart System (Recharts)

### Shared chart config
```tsx
// Common props for all charts
<ResponsiveContainer width="100%" height={240}>
  <Chart>
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
    <XAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 11 }} axisLine={false} tickLine={false} />
    <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 11 }} axisLine={false} tickLine={false} />
    <Tooltip
      contentStyle={{
        background: "#0c1221",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        color: "rgba(255,255,255,0.8)",
        fontSize: 12,
      }}
    />
  </Chart>
</ResponsiveContainer>
```

### Revenue Chart (BarChart)
- Single bar series: `fill="hsl(258 88% 66%)"` with `fillOpacity={0.85}`
- Hover bar: `fillOpacity={1}` + cursor rectangle `fill="rgba(255,255,255,0.03)"`
- Height: 240px

### Cash Flow Chart (AreaChart / ComposedChart)
- Inflow area: `stroke="hsl(158 64% 48%)"` emerald, `fill` gradient 30%→0%
- Outflow area: `stroke="hsl(0 72% 56%)"` red, same gradient
- Balance line: `stroke="hsl(258 88% 66%)"` violet, dashed
- Height: 240px

### Category / Expense Chart (PieChart or HorizontalBar)
- Colors: chart-1 through chart-5 cycling
- Legend: right-aligned, text-xs, text-white/50

### Sparklines (inline metric cards)
- `<LineChart>` 100×40px, no axes, no tooltip
- `<Line type="monotone" dot={false} strokeWidth={1.5}>`
- Color varies by severity: emerald=good, amber=warning, red=critical

---

## 7. Page Inventory

### Page 1 — War Room (`/dashboard`)
**Purpose:** CEO pulse view — 5 key metrics at a glance  
**Grid layout (rows):**
```
Row 1: [RunwayCard 2/3] [CashBalance MetricCard 1/3]
Row 2: [MRR MetricCard] [BurnRate MetricCard] [AlertsCard]
Row 3: [RevenueChart 2/3] [TopDebtors list 1/3]
Row 4: [CashFlowChart 1/2] [ExpenseBreakdown PieChart 1/2]
Row 5: [QuickActions bar — full width]
```
**Empty state:** dashed border card with TrendingUp icon and "Connect a data source" CTA

### Page 2 — Revenue (`/dashboard/revenue`)
**Purpose:** Revenue deep-dive, customer concentration  
**Grid layout:**
```
Row 1: [MRR] [ARR] [MoM Growth] [YoY Growth]  — 4 equal metric cards
Row 2: [RevenueChart 12 months — full width]
Row 3: [MRR Trend line] [Customer table with revenue share bars]
```

### Page 3 — Cash Flow (`/dashboard/cashflow`)
**Purpose:** Cash position, runway forecast, burn breakdown  
**Grid layout:**
```
Row 1: [CashFlowChart 90 days — full width]
Row 2: [30-day forecast] [60-day forecast] [90-day forecast]  — 3 equal cards
Row 3: [Monthly table: income/expenses/net] [CategoryChart]
```

### Page 4 — Collections (`/dashboard/collections`)
**Purpose:** AR management, debtor tracking  
**Grid layout:**
```
Row 1: [Total Outstanding] [Avg Days Overdue] [Collection Rate] [# Active Debtors]
Row 2: [Debtor table — full width, sortable]
       Columns: Name | Outstanding | Last txn | Risk score | Action CTA
```

### Page 5 — AI Intelligence (`/dashboard/intelligence`)
**Purpose:** Claude-powered financial chat + pre-built insights  
**Layout:**
```
Left panel (40%): 10 insight cards (runway, burn, concentration, anomaly, tax, forecast, etc.)
Right panel (60%): Chat interface
  — Message history scroll
  — Input bar at bottom (textarea + send button)
  — Assistant messages: bg-card with violet left border
  — User messages: right-aligned, bg-primary/10
```

### Page 6 — Connectors (`/dashboard/connectors`)
**Purpose:** Connect payment gateways / accounting tools  
**Layout:** 3-column card grid (responsive 1→2→3 cols)  
**Connector card anatomy:**
```
┌──────────────────────────────────────┐
│ [icon] Razorpay         ● Live       │
│        Payments, refunds, disputes   │
│                                      │
│  ┌──────────────────────────────┐    │  ← instance row
│  │ Razorpay Production  ✏ ↺ 🗑 │    │
│  │ rzp_live_XXXXX…1234         │    │
│  └──────────────────────────────┘    │
│                                      │
│  [+ Add Account]                     │
└──────────────────────────────────────┘
```
- Active card: `border-emerald-500/20 shadow-[0_0_20px_hsl(158_64%_48%/0.08)]`
- Instance row: `border-white/[0.06] bg-white/[0.025]`
- Confirmation row (on delete): `border-red-500/30 bg-red-500/[0.06]`

### Page 7 — Raw Data (`/dashboard/data`)
**Purpose:** Full transaction ledger for technical verification  
**Layout:**
```
Row 1: Filter bar — date range | connector | source | type | search
Row 2: 6 summary cards — Payments | Settlements | Refunds | Disputes | Fees | Net Flow
Row 3: Table — 11 columns, sortable headers, expandable metadata rows
Row 4: Pagination + CSV export button
```
**Summary card:**
```
┌──────────────────────┐
│ Payments             │
│ ₹24.3L              │  ← compact currency
│ 1,247 transactions   │
└──────────────────────┘
```

---

## 8. Animation System

### Keyframes
```css
@keyframes slideInUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
```

### Utility Classes
| Class | Animation | Delay |
|-------|-----------|-------|
| `.animate-enter` | slideInUp 0.4s spring | 0ms |
| `.animate-enter-delay-1` | slideInUp 0.4s spring | 50ms |
| `.animate-enter-delay-2` | slideInUp 0.4s spring | 100ms |
| `.animate-enter-delay-3` | slideInUp 0.4s spring | 150ms |
| `.animate-enter-delay-4` | slideInUp 0.4s spring | 200ms |
| `.animate-fade-in` | fadeIn 0.5s ease | 0ms |
| `.animate-scale-in` | scaleIn 0.3s spring | 0ms |

Spring easing: `cubic-bezier(0.16, 1, 0.3, 1)` (Expo out — snappy but smooth)

### Hover Micro-interactions
- Cards: `hover:-translate-y-0.5 hover:border-border transition-all duration-300`
- Buttons: `transition-all duration-150`
- Nav items: `transition-all duration-150`
- Sidebar collapse: `transition-all duration-300 ease-out`

### Loading States
- Spinning icon: `animate-spin` on `RefreshCw`
- Pulsing glow dot: `animate-pulse` on live status indicators
- Skeleton: intentionally not used — pages suspend with a full-page loader (`loading.tsx`)

---

## 9. Special Effects

### Ambient Background
```css
body::before {
  content: "";
  position: fixed; inset: 0;
  pointer-events: none; z-index: 0;
  background:
    radial-gradient(ellipse 60% 40% at 15% 0%,   hsl(258 88% 66% / 0.07) 0%, transparent 60%),
    radial-gradient(ellipse 50% 35% at 85% 100%,  hsl(199 89% 54% / 0.05) 0%, transparent 60%);
}
```
Subtle violet blob top-left, sky-blue blob bottom-right.

### Glow Utilities
```css
.glow-primary    { box-shadow: 0 0 20px hsl(258 88% 66% / 0.25), 0 0 40px hsl(258 88% 66% / 0.1); }
.glow-success    { box-shadow: 0 0 20px hsl(158 64% 48% / 0.25); }
.glow-warning    { box-shadow: 0 0 20px hsl(38 92% 56% / 0.25);  }
.glow-destructive{ box-shadow: 0 0 20px hsl(0 72% 56% / 0.25);   }
```
Used on: logo box, active nav dots, primary CTA buttons, runway severity rings

### Glass Surfaces
```css
.glass {
  background: rgba(12, 18, 33, 0.7);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
```
Used on: TopBar, mobile drawer overlay, modals

### Active Nav Indicator
```
3px wide pill, left edge of nav item
height: 20px, rounded-right
color: primary
shadow: 0 0 8px hsl(258 88% 66% / 0.6)
```

### Scrollbar
```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(220 25% 18%); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: hsl(220 25% 26%); }
```

---

## 10. Icon System

All icons: [Lucide React](https://lucide.dev) — consistent stroke-width 1.5, sizes `w-4 h-4` (16px) standard, `w-3.5 h-3.5` (14px) for inline/compact usage.

### Page Icon Map
| Page | Icon | Emoji |
|------|------|-------|
| War Room | `LayoutDashboard` | ⚡ |
| Revenue | `TrendingUp` | 📈 |
| Cash Flow | `ArrowLeftRight` | 💧 |
| Collections | `DollarSign` | 📬 |
| AI Intelligence | `Brain` | 🧠 |
| Connectors | `Plug` | 🔌 |
| Raw Data | `Table2` | 🗄️ |

### Action Icon Map
| Action | Icon |
|--------|------|
| Sync / Refresh | `RefreshCw` |
| Notifications | `Bell` |
| Sign out | `LogOut` |
| Collapse | `ChevronLeft` / `ChevronRight` |
| Edit | `Pencil` |
| Delete | `Trash2` |
| Add | `Plus` |
| Connect | `Zap` |
| Upload | `Upload` |
| Export | `Download` |
| Sort ascending | `ChevronUp` |
| Sort descending | `ChevronDown` |
| Success | `CheckCircle2` |
| Warning | `AlertTriangle` |
| Critical | `AlertCircle` |
| Info | `Info` |

---

## 11. Empty States
Every data-dependent section has a consistent empty state pattern:
```
centered vertically + horizontally
icon: 32–40px, wrapped in rounded square with bg-primary/10 border-primary/20
  + glow: shadow-[0_0_30px_hsl(258_88%_66%/0.15)]
heading: font-bold text-white/75 text-lg
subtext: text-sm text-white/30 max-w-sm leading-relaxed
CTA: Button with Zap icon → /dashboard/connectors
```

---

## 12. Connector Card States

| State | Border | Background | Indicator |
|-------|--------|------------|-----------|
| Not connected | `border-border/60` | card | — |
| Active | `border-emerald-500/20` | card + green glow | ● Live (pulse) |
| Error | `border-red-500/20` | `bg-red-500/[0.04]` | red dot |
| Syncing | — | — | `RefreshCw animate-spin` |
| Confirming delete | `border-red-500/30` | `bg-red-500/[0.06]` | inline confirm row |

---

## 13. Data Table (Raw Data page)

### Column widths
| Column | Width | Notes |
|--------|-------|-------|
| Date | 100px | `YYYY-MM-DD`, monospace |
| Type | 70px | `credit`/`debit` badge |
| Amount | 110px | right-aligned, tabular nums |
| Currency | 60px | `INR`/`USD` badge |
| Source | 120px | `razorpay_payment` etc |
| Status | 90px | pill badge |
| Description | auto | truncate |
| Counterparty | 140px | truncate |
| Category | 100px | |
| Connector | 120px | |
| ▶ Expand | 36px | expand metadata JSON |

### Row hover
`hover:bg-white/[0.02]`

### Expanded metadata row
`bg-white/[0.01] border-t border-white/[0.04]`
JSON rendered as key-value grid with `font-mono text-xs text-white/40`

### Pagination
`text-xs text-white/30` | `←` `→` buttons | `Rows per page: 50`

---

## 14. AI Chat (Intelligence page)

### Chat bubble — Assistant
```
bg-card border border-white/[0.06] rounded-2xl rounded-tl-sm
border-l-2 border-l-primary/40
max-w-[85%] p-4
text-sm text-white/75 leading-relaxed
```

### Chat bubble — User
```
bg-primary/[0.08] border border-primary/10 rounded-2xl rounded-tr-sm
ml-auto max-w-[80%] p-3
text-sm text-white/80
```

### Input bar
```
border-t border-white/[0.05]
textarea: auto-resize, bg-transparent, text-sm
send button: primary, rounded-lg
```

### Pre-built insight cards
```
10 cards in a 2-column grid
Each: icon + title + 1-line description
Click → prefills chat with analysis prompt
Hover: border-primary/20 bg-primary/[0.04]
```

---

## 15. Onboarding Flow

### `/auth/login`
- Center-aligned card on full viewport (`bg-background`)
- Same glass card: `bg-[#0c1221] border-white/[0.08] rounded-2xl`
- Logo + product name at top
- Email + password inputs
- Primary "Sign in" button with violet glow

### `/onboarding`
- Single-step form: company name input
- "Create your workspace" heading
- Submits → creates org → redirects to `/dashboard`

---

## 16. Mobile Patterns

### Mobile Sidebar
- Triggered by hamburger in TopBar on `<lg`
- Full-height drawer slides in from left
- Overlay: `bg-black/60 backdrop-blur-md`
- Same nav items as desktop sidebar

### Responsive card grid
| Screen | Columns |
|--------|---------|
| `xs` (<640px) | 1 column |
| `sm` (640px+) | 2 columns |
| `lg` (1024px+) | 3–4 columns |

---

## 17. Key Tailwind Patterns (Copy-Paste)

```tsx
// Deep card with hover lift
"rounded-2xl border border-border/60 bg-card p-5 hover:border-border hover:-translate-y-0.5 transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,0.4)]"

// Active connector card
"border-emerald-500/20 shadow-[0_0_20px_hsl(158_64%_48%/0.08)]"

// Micro section label
"text-[10px] font-semibold text-white/35 uppercase tracking-[0.12em]"

// Ghost action button
"p-1.5 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-all"

// Danger action button
"p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/[0.08] transition-all"

// Primary CTA glow
"shadow-[0_0_20px_hsl(258_88%_66%/0.3)]"

// Logo box glow
"bg-primary/20 border border-primary/30 shadow-[0_0_12px_hsl(258_88%_66%/0.3)]"

// Pill badge — success
"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"

// Pill badge — warning
"bg-amber-400/10 text-amber-400 border-amber-400/20"

// Pill badge — destructive
"bg-red-400/10 text-red-400 border-red-400/20"

// Instance row in connector card
"flex items-center gap-2 rounded-xl px-3 py-2.5 border border-white/[0.06] bg-white/[0.025]"

// Modal overlay
"fixed inset-0 z-40 bg-black/60 backdrop-blur-md"

// Modal content
"fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#0c1221] border border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] p-6"

// Table header cell
"text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30 px-3 py-2.5 text-left"

// Divider with centered label
<div className="flex items-center gap-2 py-1">
  <div className="flex-1 h-px bg-white/[0.05]" />
  <span className="text-[10px] text-white/20 uppercase tracking-widest">LABEL</span>
  <div className="flex-1 h-px bg-white/[0.05]" />
</div>
```

---

## 18. Tech Stack (for reference)

| Layer | Library |
|-------|---------|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS 3 + CSS custom properties |
| Components | shadcn/ui (base-nova theme) + Radix UI primitives |
| Icons | Lucide React |
| Charts | Recharts |
| Animations | CSS keyframes + Tailwind classes |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (SSR cookie-based) |
| Fonts | System font stack (no web font loading) |
| Color mode | Dark only (`color-scheme: dark`) |
