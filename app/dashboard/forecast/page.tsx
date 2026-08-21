export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getOrgId, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { getForecast, sampleForecast } from "@/lib/forecast";
import { ForecastClient } from "./forecast-client";

export default async function ForecastPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("forecast");

  const preview = !(await orgHasConnectors(orgId));
  const data = preview ? sampleForecast() : await getForecast(orgId);

  return <ForecastClient data={data} />;
}
