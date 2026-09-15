import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgRead } from "@/lib/api/auth";
import { getCardPrefs, sanitizeCardPrefs } from "@/lib/cards/prefs";

const TAB_RE = /^[a-z0-9_-]{1,32}$/;

/** GET /api/card-prefs?org_id=&tab= — the caller's card layout for a tab. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const orgId = req.nextUrl.searchParams.get("org_id");
  const tab = req.nextUrl.searchParams.get("tab");
  if (!orgId || !tab || !TAB_RE.test(tab)) {
    return NextResponse.json({ error: "org_id and a valid tab are required" }, { status: 400 });
  }
  const auth = await requireOrgRead(orgId); // own-row prefs → any active member (viewer incl.)
  if (isAuthFailure(auth)) return auth.error;
  const prefs = await getCardPrefs(auth.userId, auth.org.id, tab, auth.supabase);
  return NextResponse.json(prefs);
}

/** PUT /api/card-prefs — save the caller's card order + hidden set for a tab. */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; tab?: string; order?: unknown; hidden?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const orgId = body.org_id;
  const tab = body.tab;
  if (!orgId || !tab || !TAB_RE.test(tab)) {
    return NextResponse.json({ error: "org_id and a valid tab are required" }, { status: 400 });
  }
  const auth = await requireOrgRead(orgId); // own-row prefs → any active member (viewer incl.)
  if (isAuthFailure(auth)) return auth.error;

  const clean = sanitizeCardPrefs(body.order, body.hidden);
  const { error } = await auth.supabase
    .from("user_card_prefs")
    .upsert(
      { user_id: auth.userId, org_id: auth.org.id, tab, card_order: clean.order, hidden: clean.hidden, updated_at: new Date().toISOString() },
      { onConflict: "user_id,org_id,tab" }
    );

  // A missing table (migration 121 not applied yet) must not fail the request —
  // the client keeps the layout locally and it persists once the table exists.
  if (error) return NextResponse.json({ ...clean, persisted: false, warning: error.message }, { status: 200 });
  return NextResponse.json({ ...clean, persisted: true });
}
