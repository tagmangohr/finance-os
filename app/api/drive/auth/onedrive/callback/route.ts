import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { exchangeOnedriveCode, getOnedriveUserInfo } from "@/lib/drive/onedrive";
import { parseOAuthState, NONCE_COOKIE, getBaseUrl } from "@/lib/drive/oauth";

/**
 * GET /api/drive/auth/onedrive/callback?code=...&state=...
 *
 * OAuth callback from Microsoft. Exchanges the code for tokens,
 * upserts connector + drive_connection, then redirects back.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const redirectBase = `${getBaseUrl()}/dashboard/connectors`;

  const code       = req.nextUrl.searchParams.get("code");
  const state      = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${redirectBase}?drive_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?drive_error=missing_params`);
  }

  const nonce = req.cookies.get(NONCE_COOKIE("onedrive"))?.value;
  if (!nonce) {
    return NextResponse.redirect(`${redirectBase}?drive_error=csrf_missing`);
  }

  const parsed = parseOAuthState(state, nonce);
  if (!parsed || parsed.provider !== "onedrive") {
    return NextResponse.redirect(`${redirectBase}?drive_error=csrf_invalid`);
  }

  const { orgId } = parsed;

  try {
    const tokens   = await exchangeOnedriveCode(code);
    const userInfo = await getOnedriveUserInfo(tokens.access_token);

    const supabase = await createServiceClient();

    // Upsert connector anchor
    const { data: existing } = await supabase
      .from("connectors")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", "onedrive")
      .maybeSingle();

    let connectorId: string;

    if (existing) {
      connectorId = existing.id;
      await supabase
        .from("connectors")
        .update({
          name:   userInfo.email ? `OneDrive (${userInfo.email})` : "OneDrive",
          status: "active",
          config: { account_email: userInfo.email, account_name: userInfo.name },
        })
        .eq("id", connectorId);
    } else {
      const { data: created, error: createErr } = await supabase
        .from("connectors")
        .insert({
          org_id: orgId,
          type:   "onedrive",
          name:   userInfo.email ? `OneDrive (${userInfo.email})` : "OneDrive",
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

    const { error: connErr } = await supabase.from("drive_connections").upsert(
      {
        org_id:        orgId,
        connector_id:  connectorId,
        provider:      "onedrive",
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

    const res = NextResponse.redirect(`${redirectBase}?drive_connected=onedrive`);
    res.cookies.delete(NONCE_COOKIE("onedrive"));
    return res;
  } catch (err) {
    console.error("[drive/auth/onedrive/callback]", err);
    const msg = err instanceof Error ? err.message.slice(0, 80) : "unknown_error";
    return NextResponse.redirect(`${redirectBase}?drive_error=${encodeURIComponent(msg)}`);
  }
}
