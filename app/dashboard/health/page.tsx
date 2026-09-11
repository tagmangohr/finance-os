export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getOrgId } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { createServiceClient } from "@/lib/supabase/server";
import { getSyncHealth } from "@/lib/ops/health";
import { HealthClient } from "./health-client";

export default async function HealthPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("health");

  const supabase = await createServiceClient();
  const data = await getSyncHealth(orgId, supabase);
  return <HealthClient data={data} />;
}
