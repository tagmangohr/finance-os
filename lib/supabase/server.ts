import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component context — ignore
          }
        },
      },
    }
  );
}

/**
 * Service-role client for trusted server-side work that must bypass RLS.
 *
 * CRITICAL: this must be a plain supabase-js client, NOT the SSR cookie client.
 * The SSR client (createServerClient) reads the request cookies and, when a user
 * is logged in, attaches THEIR JWT as the auth token — silently downgrading the
 * "service" client to that authenticated user, so RLS is enforced. That makes any
 * service-role write inside an authenticated request fail on RLS-locked tables.
 * A sessionless plain client always uses the service-role key as intended.
 *
 * Kept async so existing `await createServiceClient()` callers are unaffected.
 */
export async function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
