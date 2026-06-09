"use server";

import { createClient } from "@/lib/supabase/server";

export async function signInAction(
  email: string,
  password: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  // createClient's setAll writes the session as Set-Cookie headers in
  // the Server Action response — browser stores them before the client
  // code continues, so the next navigation is fully authenticated.
  return {};
}
