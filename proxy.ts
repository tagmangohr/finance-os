import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Authorization gate: does this user have a legitimate path to ANY org — i.e. they
 * OWN one, or have an ACTIVE or PENDING membership (matched by user-id or the email
 * they were invited under)? Runs on every /dashboard and /api request (uncached, at
 * the edge), so removing a member takes effect on their very next action — even a
 * cached tab click, which still hits the proxy. A REMOVED member (status='revoked')
 * matches none of these → blocked.
 *
 * PENDING is allowed because an invited user's row is 'pending' (user_id NULL) until
 * the dashboard layout activates it on first load — gating them out here would break
 * invite acceptance. Uses the service key via direct REST (edge-safe, no SDK). Fails
 * OPEN on error — the layout + getActiveOrg + requireOrgRead (all active-only) are
 * hard backstops, so an error never leaks data, it only defers the redirect.
 */
async function hasAnyOrgAccess(userId: string, email: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return true; // can't check → let the render-time gates decide
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const has = async (path: string): Promise<boolean> => {
    try {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers, cache: "no-store" });
      if (!r.ok) return false;
      const rows = (await r.json()) as unknown[];
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  };
  try {
    const checks = [
      has(`organizations?select=id&owner_id=eq.${userId}&limit=1`),
      has(`org_members?select=id&user_id=eq.${userId}&status=in.(active,pending)&limit=1`),
    ];
    if (email) checks.push(has(`org_members?select=id&invited_email=eq.${encodeURIComponent(email)}&status=in.(active,pending)&limit=1`));
    const results = await Promise.all(checks);
    return results.some(Boolean);
  } catch {
    return true; // network blip → fail open; render-time gates still apply
  }
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes — no user session required. /api/v1 is the partner API,
  // authenticated by an org API key (Bearer) inside the route, not a login cookie.
  if (
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/v1")
  ) {
    return supabaseResponse;
  }

  // Protected routes — redirect to login if not authenticated
  if (!user && !pathname.startsWith("/auth")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // Authorization gate: an authenticated user with no path to any org (a removed
  // member) is blocked from the dashboard AND the app APIs — instantly, on their
  // next request. This is what makes "remove member" take effect right away instead
  // of relying on session expiry or a fresh login, and it uniformly covers even API
  // routes that don't self-enforce membership. The exempt routes (auth / webhooks /
  // cron / v1) already returned above; /onboarding + /account stay reachable so an
  // org-less user can still create/join an org.
  if (user && (pathname.startsWith("/dashboard") || pathname.startsWith("/api"))) {
    const ok = await hasAnyOrgAccess(user.id, user.email ?? "");
    if (!ok) {
      if (pathname.startsWith("/api")) {
        return NextResponse.json({ error: "Forbidden — not an active member of any organisation" }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
