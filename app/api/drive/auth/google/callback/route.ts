import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeGoogleCode, getGoogleUserInfo } from "@/lib/drive/google";
import { parseOAuthState, NONCE_COOKIE, getBaseUrl } from "@/lib/drive/oauth";

/**
 * GET /api/drive/auth/google/callback?code=...&state=...
 *
 * OAuth 2.0 callback from Google. Exchanges the code for tokens,
 * upserts a connector + drive_connection record, then redirects back
 * to the connectors page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const redirectBase = `${getBaseUrl()}/dashboard/connectors`;

  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${redirectBase}?drive_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?drive_error=missing_params`);
  }

  // ── Validate CSRF nonce ────────────────────────────────────────────────────
  const nonce = req.cookies.get(NONCE_COOKIE("google_drive"))?.value;
  if (!nonce) {
    return NextResponse.redirect(`${redirectBase}?drive_error=csrf_missing`);
  }

  const parsed = parseOAuthState(state, nonce);
  if (!parsed || parsed.provider !== "google_drive") {
    return NextResponse.redirect(`${redirectBase}?drive_error=csrf_invalid`);
  }

  const { orgId } = parsed;

  try {
    // ── Exchange code for tokens ───────────────────────────────────────────
    const tokens   = await exchangeGoogleCode(code);
    const userInfo = await getGoogleUserInfo(tokens.access_token);

    // ── Persist to DB (upsert pattern) ────────────────────────────────────
    const supabase = await createServiceClient();

    // 1. Upsert the connector record (anchor for transactions)
    const { data: existing } = await supabase
      .from("connectors")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", "google_drive")
      .maybeSingle();

    let connectorId: string;

    if (existing) {
      connectorId = existing.id;
      await supabase
        .from("connectors")
        .update({
          name:   userInfo.email ? `Google Drive (${userInfo.email})` : "Google Drive",
          status: "active",
          config: { account_email: userInfo.email, account_name: userInfo.name },
        })
        .eq("id", connectorId);
    } else {
      const { data: created, error: createErr } = await supabase
        .from("connectors")
        .insert({
          org_id: orgId,
          type:   "google_drive",
          name:   userInfo.email ? `Google Drive (${userInfo.email})` : "Google Drive",
          status: "active",
          config: { account_email: userInfo.email, account_name: userInfo.name },
        })
        .select("id")
        .single();

      if (createErr || !created) {
        throw new Error(`Failed to create connector: ${createErr?.message}`);
      }
      connectorId = created.id;
    }

    // 2. Upsert the drive_connection record (stores tokens)
    const { error: connErr } = await supabase.from("drive_connections").upsert(
      {
        org_id:        orgId,
        connector_id:  connectorId,
        provider:      "google_drive",
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry:  tokens.expiry,
        account_email: userInfo.email,
        account_name:  userInfo.name,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: "org_id,provider" }
    );

    if (connErr) throw new Error(`Failed to save connection: ${connErr.message}`);

    // ── Clear the nonce cookie and redirect ───────────────────────────────
    const res = NextResponse.redirect(`${redirectBase}?drive_connected=google_drive`);
    res.cookies.delete(NONCE_COOKIE("google_drive"));
    return res;
  } catch (err) {
    console.error("[drive/auth/google/callback]", err);
    const msg = err instanceof Error ? err.message.slice(0, 80) : "unknown_error";
    return NextResponse.redirect(`${redirectBase}?drive_error=${encodeURIComponent(msg)}`);
  }
}
