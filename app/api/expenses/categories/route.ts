import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/expenses/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREATMENTS = ["expense", "income", "excluded", "uncategorized"] as const;
const FLOWS = ["in", "out", "both"] as const;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** GET — the effective taxonomy (system + org). Admin/finance-gated. */
export async function GET(): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sb = await createServiceClient();
  return NextResponse.json({ categories: await getCategories(org.id, sb) });
}

/**
 * POST — add an org-specific category. Body: { label, treatment, flow? }.
 * Admin/finance-gated. Slug is derived from the label.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { label?: unknown; treatment?: unknown; flow?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const treatment = TREATMENTS.includes(body.treatment as never) ? (body.treatment as string) : "";
  const flow = FLOWS.includes(body.flow as never) ? (body.flow as string) : "out";
  if (!label || !treatment) {
    return NextResponse.json({ error: "label and a valid treatment are required" }, { status: 400 });
  }
  const slug = slugify(label);
  if (!slug) return NextResponse.json({ error: "label produces an empty slug" }, { status: 400 });

  const sb = await createServiceClient();
  const { error } = await sb.from("ledger_categories").insert({
    org_id: org.id, slug, label, treatment, flow, sort: 500, is_system: false,
  });
  if (error) {
    // 23505 = the org already has this slug.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, slug });
}
