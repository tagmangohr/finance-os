export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataExplorerClient } from "./data-client";

export default async function DataPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();

  if (!org) redirect("/onboarding");

  // Fetch all connectors so the filter dropdown is populated
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, name, type")
    .eq("org_id", org.id)
    .order("created_at", { ascending: true });

  return <DataExplorerClient orgId={org.id} connectors={connectors ?? []} />;
}
