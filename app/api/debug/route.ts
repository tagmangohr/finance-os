import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Temporary diagnostic endpoint — remove after debugging is done
export async function GET() {
  try {
    const supabase = await createClient();

    // Step 1: Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({
        step: "auth",
        authenticated: false,
        authError: authError?.message ?? "No user returned",
      });
    }

    // Step 2: Direct org query (same as layout)
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, name, slug, owner_id")
      .eq("owner_id", user.id)
      .maybeSingle();

    // Step 3: List ALL orgs visible to this user (to check RLS)
    const { data: allOrgs, error: allOrgsError } = await supabase
      .from("organizations")
      .select("id, name, slug, owner_id")
      .limit(5);

    return NextResponse.json({
      authenticated: true,
      userId: user.id,
      email: user.email,
      org,
      orgError: orgError?.message ?? null,
      allOrgs,
      allOrgsError: allOrgsError?.message ?? null,
    });
  } catch (err: unknown) {
    return NextResponse.json({
      step: "exception",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
