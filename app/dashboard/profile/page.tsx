import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ProfileClient } from "./profile-client";

export const metadata = { title: "Profile — Finance OS" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Try owner first
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, currency, timezone")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // If not owner, check membership to get their org
  let memberOrg = org;
  if (!org) {
    try {
      const serviceClient = await createServiceClient();
      const { data: member } = await serviceClient
        .from("org_members")
        .select("organizations(id, name, slug, currency, timezone)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      memberOrg = (member?.organizations as unknown as typeof org) ?? null;
    } catch {
      // org_members table not yet created — safe to ignore
    }
  }

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
          org:      memberOrg,
          is_owner: !!org,
        }}
      />
    </div>
  );
}
