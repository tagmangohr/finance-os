import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // If not logged in, proxy handles the redirect to /auth/login — this is a
  // belt-and-suspenders guard in case the proxy is bypassed.
  if (!user) redirect("/auth/login");

  // If the user already owns an org, skip onboarding entirely.
  // This server-side redirect is the reliable path (no client navigation races).
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingOrg) redirect("/dashboard");

  return <OnboardingForm />;
}
