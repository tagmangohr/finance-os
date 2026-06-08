import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleAuthUrl } from "@/lib/drive/google";
import { NONCE_COOKIE } from "@/lib/drive/oauth";

/**
 * GET /api/drive/auth/google?org_id=<orgId>
 *
 * Generates a Google OAuth URL and returns it as JSON.
 * The client is responsible for redirecting to that URL.
 * Also returns a nonce that must be set as a cookie before the redirect.
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

  // Verify org ownership
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
    // Single call — stateParam embedded in authUrl and the nonce stored in the
    // cookie come from the same buildOAuthState() invocation.  Using two
    // separate calls generated different nonces and always caused csrf_invalid.
    const { url: authUrl, stateParam, nonce } = getGoogleAuthUrl(orgId);

    // Return the auth URL and nonce — client sets the nonce cookie then redirects
    const res = NextResponse.json({ authUrl, stateParam });
    res.cookies.set(NONCE_COOKIE("google_drive"), nonce, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   600, // 10 minutes
      path:     "/",
    });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("GOOGLE_CLIENT_ID")) {
      return NextResponse.json(
        { error: "Google Drive is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
