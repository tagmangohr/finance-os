export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getOrgId, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { getPnl, samplePnl, fyStartForDate } from "@/lib/pnl";
import { PnlClient } from "./pnl-client";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("pnl");

  const { fy } = await searchParams;
  const currentFy = fyStartForDate(new Date());
  const parsed = Number(fy);
  // Clamp to a sane window (2020 … current FY) so a junk ?fy= can't fetch forever.
  const fyStart = Number.isFinite(parsed) && parsed >= 2020 && parsed <= currentFy ? parsed : currentFy;

  const preview = !(await orgHasConnectors(orgId));
  const data = preview ? samplePnl(fyStart) : await getPnl(orgId, fyStart);

  // Year options: current FY back to whichever is later of 2021 or 5 years ago.
  const years: number[] = [];
  for (let y = currentFy; y >= Math.max(2021, currentFy - 5); y--) years.push(y);

  return <PnlClient data={data} orgId={orgId} years={years} />;
}
