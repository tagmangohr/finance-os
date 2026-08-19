import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hasPageAccessForOrg } from "@/lib/org/page-access";
import { getFinancialSummary } from "@/lib/intelligence/index";
import { askFinancialQuestion, type ChatMessage } from "@/lib/intelligence/claude";

// The intelligence modules now paginate their windowed queries (no silent 1000-row
// truncation). On a large org that's several sequential pages per module; give the
// on-demand call headroom (capped lower automatically on Hobby-tier).
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("org_id");

    if (!orgId) {
      return NextResponse.json({ error: "org_id required" }, { status: 400 });
    }

    // Co-pilot access = owner/admin, or a member granted the "intelligence" page.
    if (!(await hasPageAccessForOrg(orgId, "intelligence"))) {
      return NextResponse.json({ error: "Forbidden — no access to the AI co-pilot" }, { status: 403 });
    }

    // Access authorized above → read financial data with the service client so a
    // granted non-owner member still gets a fully-populated context (not RLS-limited).
    const supabase = await createServiceClient();
    const summary = await getFinancialSummary(orgId, supabase);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("Intelligence GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate summary" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { org_id, question, history = [] } = body as {
      org_id: string;
      question: string;
      history: ChatMessage[];
    };

    if (!org_id || !question) {
      return NextResponse.json({ error: "org_id and question required" }, { status: 400 });
    }

    // Co-pilot access = owner/admin, or a member granted the "intelligence" page.
    if (!(await hasPageAccessForOrg(org_id, "intelligence"))) {
      return NextResponse.json({ error: "Forbidden — no access to the AI co-pilot" }, { status: 403 });
    }

    // Access authorized → read financial data with the service client (bypasses
    // member RLS, which would otherwise starve the context for non-owners).
    const supabase = await createServiceClient();
    const answer = await askFinancialQuestion(org_id, question, history, supabase);
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("Intelligence POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate answer" },
      { status: 500 }
    );
  }
}
