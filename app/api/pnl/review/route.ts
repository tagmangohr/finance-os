import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Mark for review" flags on P&L line items → an accounting review queue.
// Org is resolved SERVER-SIDE (never trusted from the client) and the caller must
// have P&L page access. Writes go through the service client; the table itself is
// locked to service_role (112), so this route is the only door.

const ISO = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Ctx =
  | { error: NextResponse; org?: undefined; userId?: undefined; email?: undefined }
  | { error: null; org: { id: string }; userId: string; email: string | null };

// Authorise: authenticated + active org + 'pnl' page access (read is enough to
// raise/resolve a review note — the accounting team may be non-admin viewers).
async function ctx(): Promise<Ctx> {
  const { userId, org, pageAccess } = await getActiveOrg();
  if (!userId || !org) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const canPnl = pageAccess == null || pageAccess.includes("pnl");
  if (!canPnl) return { error: NextResponse.json({ error: "Forbidden — no access to Profit & Loss" }, { status: 403 }) };
  let email: string | null = null;
  try {
    const cookieClient = await createClient();
    const { data } = await cookieClient.auth.getUser();
    email = data.user?.email ?? null;
  } catch { /* email is a display snapshot only */ }
  return { error: null, org, userId, email };
}

const FLAG_COLS =
  "id, drill_key, party, party_label, category_label, period_from, period_to, period_label, amount_snapshot, note, status, created_by_email, created_at, resolved_by_email, resolved_at";

// GET /api/pnl/review?status=open|resolved|all  → flags for the active org.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const c = await ctx();
  if (c.error) return c.error;
  const status = req.nextUrl.searchParams.get("status") ?? "open";
  const supabase = await createServiceClient();
  let q = supabase.from("pnl_review_flags").select(FLAG_COLS).eq("org_id", c.org.id);
  if (status === "open" || status === "resolved") q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) return NextResponse.json({ flags: [] });
  return NextResponse.json({ flags: data ?? [] });
}

// POST → raise a flag (or refresh the note/amount on an already-open one).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = await ctx();
  if (c.error) return c.error;
  const body = await req.json().catch(() => ({}));

  const drill_key = str(body.drill_key, 120);
  const party = str(body.party, 300);
  const period_from = ISO(body.period_from);
  const period_to = ISO(body.period_to);
  if (!drill_key || !party || !period_from || !period_to) {
    return NextResponse.json({ error: "drill_key, party, period_from, period_to required" }, { status: 400 });
  }
  const amount = Number(body.amount);
  const row = {
    org_id: c.org.id,
    drill_key,
    party,
    party_label: str(body.party_label, 300) || null,
    category_label: str(body.category_label, 200) || null,
    period_from,
    period_to,
    period_label: str(body.period_label, 60) || null,
    amount_snapshot: Number.isFinite(amount) ? amount : null,
    note: str(body.note, 2000) || null,
  };

  const supabase = await createServiceClient();
  // At most one OPEN flag per (org, line item, period): update the existing open
  // flag's note/amount instead of creating a duplicate (mirrors uq_pnl_flag_open).
  const { data: existing } = await supabase
    .from("pnl_review_flags")
    .select("id")
    .eq("org_id", c.org.id)
    .eq("drill_key", drill_key)
    .eq("party", party)
    .eq("period_from", period_from)
    .eq("period_to", period_to)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("pnl_review_flags")
      .update({ note: row.note, amount_snapshot: row.amount_snapshot, period_label: row.period_label, category_label: row.category_label, party_label: row.party_label })
      .eq("id", existing.id).eq("org_id", c.org.id)
      .select(FLAG_COLS).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ flag: data, updated: true });
  }

  const { data, error } = await supabase
    .from("pnl_review_flags")
    .insert({ ...row, created_by: c.userId, created_by_email: c.email })
    .select(FLAG_COLS).single();
  if (error) {
    // Lost a race: another request opened the same (org, line item, period) flag
    // between our check and insert (uq_pnl_flag_open). Fold into an update instead
    // of surfacing a 500.
    if (error.code === "23505") {
      const { data: upd, error: uErr } = await supabase
        .from("pnl_review_flags")
        .update({ note: row.note, amount_snapshot: row.amount_snapshot, period_label: row.period_label, category_label: row.category_label, party_label: row.party_label })
        .eq("org_id", c.org.id).eq("drill_key", drill_key).eq("party", party)
        .eq("period_from", period_from).eq("period_to", period_to).eq("status", "open")
        .select(FLAG_COLS).maybeSingle();
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
      return NextResponse.json({ flag: upd, updated: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ flag: data, updated: false });
}

// PATCH { id, status: 'open'|'resolved' } → resolve or reopen a flag (org-scoped).
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const c = await ctx();
  if (c.error) return c.error;
  const body = await req.json().catch(() => ({}));
  const id = str(body.id, 64);
  const status = body.status === "resolved" || body.status === "open" ? body.status : null;
  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });

  const patch =
    status === "resolved"
      ? { status, resolved_by: c.userId, resolved_by_email: c.email, resolved_at: new Date().toISOString() }
      : { status, resolved_by: null, resolved_by_email: null, resolved_at: null };

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("pnl_review_flags")
    .update(patch)
    .eq("id", id).eq("org_id", c.org.id)      // org scope: can't touch another org's flag
    .select(FLAG_COLS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ flag: data });
}
