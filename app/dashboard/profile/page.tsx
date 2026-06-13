import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { ProfileClient } from "./profile-client";

export const metadata = { title: "Profile — Finance OS" };

export default async function ProfilePage() {
  const supabase = await createClient();

  // Show details for the ACTIVE org (owned or member).
  const { userId, org: active } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!active) redirect("/onboarding");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Fetch the active org's full settings. Service client is fine here — access
  // is already proven by getActiveOrg returning it in the accessible set.
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, currency, timezone")
    .eq("id", active.id)
    .maybeSingle();

  const isOwner = active.role === "owner";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[18px] font-bold text-white/85 tracking-tight">Profile</h1>
        <p className="text-[12px] text-white/35 mt-0.5">Manage your account and company settings</p>
      </div>

      <ProfileClient
        initial={{
          user: {
            id:        user.id,
            email:     user.email ?? "",
            full_name: (user.user_metadata?.full_name as string | undefined) ?? "",
          },
          org:      org,
          is_owner: isOwner,
        }}
      />
    </div>
  );
}
