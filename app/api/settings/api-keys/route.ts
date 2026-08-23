import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner/admin-only management of the org's partner API keys. The plaintext key is
// returned ONCE from POST and never stored (only its hash is).

type OwnerCtx =
  | { error: NextResponse; userId?: undefined; org?: undefined }
  | { error: null; userId: string; org: { id: string } };

async function ownerOrg(): Promise<OwnerCtx> {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId || !org) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canManageTeam) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { error: null, userId, org };
}

// GET → list keys (no secrets).
export async function GET(): Promise<NextResponse> {
  const ctx = await ownerOrg();
  if (ctx.error) return ctx.error;
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at")
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ keys: [] });
  return NextResponse.json({ keys: data ?? [] });
}

// POST { name } → create a key; returns the plaintext ONCE.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await ownerOrg();
  if (ctx.error) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "API key";

  const { key, prefix, hash } = generateApiKey();
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({ org_id: ctx.org.id, name, key_prefix: prefix, key_hash: hash, scopes: ["payments:read"], created_by: ctx.userId })
    .select("id, name, key_prefix, scopes, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key, record: data });
}

// DELETE ?id= → revoke a key.
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const ctx = await ownerOrg();
  if (ctx.error) return ctx.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", ctx.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
