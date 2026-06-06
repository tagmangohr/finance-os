import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOnedriveAuthUrl } from "@/lib/drive/onedrive";
import { buildOAuthState, NONCE_COOKIE } from "@/lib/drive/oauth";

/**
 * GET /api/drive/auth/onedrive?org_id=<orgId>
 *
 * Generates a Microsoft OAuth URL and returns it as JSON.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = req.nextUrl.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const { data: org, error } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (error || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    const { stateParam, nonce } = buildOAuthState(orgId, "onedrive");
    const authUrl = getOnedriveAuthUrl(orgId);

    const res = NextResponse.json({ authUrl, stateParam });
    res.cookies.set(NONCE_COOKIE("onedrive"), nonce, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   600,
      path:     "/",
    });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ONEDRIVE_CLIENT_ID")) {
      return NextResponse.json(
        { error: "OneDrive is not configured. Set ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
