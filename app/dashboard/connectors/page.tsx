export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConnectorsClient } from "./connectors-client";

export default async function ConnectorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!org) redirect("/onboarding");

  const { data: connectors } = await supabase
    .from("connectors")
    .select("*")
    .eq("org_id", org.id)
    .order("created_at", { ascending: true });

  return <ConnectorsClient orgId={org.id} connectors={connectors ?? []} />;
}
