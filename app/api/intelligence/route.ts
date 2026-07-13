import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    const supabase = await createClient();

    // Verify user has access to this org
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .eq("owner_id", user.id)
      .single();

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

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

    const supabase = await createClient();

    // Verify access
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("id", org_id)
      .eq("owner_id", user.id)
      .single();

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

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
