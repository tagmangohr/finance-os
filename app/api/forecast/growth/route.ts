import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hasPageAccessForOrg } from "@/lib/org/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/forecast/growth?org= → { overrides: { slug: pct } }
export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = req.nextUrl.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org required" }, { status: 400 });
  if (!(await hasPageAccessForOrg(org, "forecast"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServiceClient();
  const { data, error } = await supabase.from("forecast_growth").select("line_slug, growth_pct").eq("org_id", org);
  if (error) return NextResponse.json({ overrides: {} }); // table missing pre-migration → empty
  const overrides: Record<string, number> = {};
  for (const r of (data ?? []) as { line_slug: string; growth_pct: number }[]) overrides[r.line_slug] = Number(r.growth_pct);
  return NextResponse.json({ overrides });
}

// PUT /api/forecast/growth  { org, line_slug, growth_pct } → upsert one override
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const { org, line_slug, growth_pct } = body as { org?: string; line_slug?: string; growth_pct?: number };
  if (!org || !line_slug || typeof growth_pct !== "number" || !Number.isFinite(growth_pct)) {
    return NextResponse.json({ error: "org, line_slug, numeric growth_pct required" }, { status: 400 });
  }
  if (!(await hasPageAccessForOrg(org, "forecast"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("forecast_growth")
    .upsert({ org_id: org, line_slug, growth_pct, updated_at: new Date().toISOString() }, { onConflict: "org_id,line_slug" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/forecast/growth?org=  → clear all overrides (revert to trend)
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const org = req.nextUrl.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org required" }, { status: 400 });
  if (!(await hasPageAccessForOrg(org, "forecast"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServiceClient();
  const { error } = await supabase.from("forecast_growth").delete().eq("org_id", org);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
