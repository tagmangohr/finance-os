export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getOrgId, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { fyStartForDate } from "@/lib/pnl";
import { getVariance, sampleVariance } from "@/lib/variance";
import { VarianceClient } from "./variance-client";

export default async function VariancePage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("variance");

  const { fy } = await searchParams;
  const currentFy = fyStartForDate(new Date());
  const parsed = Number(fy);
  const fyStart = Number.isFinite(parsed) && parsed >= 2020 && parsed <= currentFy ? parsed : currentFy;

  const preview = !(await orgHasConnectors(orgId));
  const data = preview ? sampleVariance(fyStart) : await getVariance(orgId, fyStart);

  const years: number[] = [];
  for (let y = currentFy; y >= Math.max(2021, currentFy - 6); y--) years.push(y);

  return <VarianceClient data={data} years={years} />;
}
