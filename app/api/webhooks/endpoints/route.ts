import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptValue } from "@/lib/crypto/secrets";
import { generateSigningSecret, validateWebhookUrl } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner/admin-only management of outbound webhook endpoints. The signing secret is
// returned in plaintext ONCE from POST and stored encrypted (never returned again).

const SAFE_COLS = "id, url, description, enabled, event_types, enabled_at, created_at";

type Ctx =
  | { error: NextResponse; userId?: undefined; org?: undefined }
  | { error: null; userId: string; org: { id: string } };

async function manageCtx(): Promise<Ctx> {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId || !org) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canManageTeam) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { error: null, userId, org };
}

// GET → list endpoints (no secrets).
export async function GET(): Promise<NextResponse> {
  const ctx = await manageCtx();
  if (ctx.error) return ctx.error;
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(SAFE_COLS)
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ endpoints: [] });
  return NextResponse.json({ endpoints: data ?? [] });
}

// POST { url, description? } → create; returns the signing secret ONCE.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await manageCtx();
  if (ctx.error) return ctx.error;
  const body = await req.json().catch(() => ({}));

  const check = validateWebhookUrl(String(body.url ?? ""));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 120) || null : null;

  const secret = generateSigningSecret();
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({ org_id: ctx.org.id, url: check.url, description, secret: encryptValue(secret) })
    .select(SAFE_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ secret, endpoint: data });
}

// PATCH ?id= { enabled?, url?, description? } → update.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = await manageCtx();
  if (ctx.error) return ctx.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.description === "string") patch.description = body.description.trim().slice(0, 120) || null;
  if (typeof body.url === "string") {
    const check = validateWebhookUrl(body.url);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    patch.url = check.url;
  }

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update(patch)
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .select(SAFE_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ endpoint: data });
}

// DELETE ?id= → remove the endpoint (its deliveries cascade).
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const ctx = await manageCtx();
  if (ctx.error) return ctx.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
