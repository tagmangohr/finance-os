export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getOrgId, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { getAnalytics, sampleAnalytics } from "@/lib/analytics";
import { fyStartForDate } from "@/lib/pnl";
import { AnalyticsClient } from "./analytics-client";

const ISO = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("analytics");

  const sp = await searchParams;
  const currentFy = fyStartForDate(new Date());
  const from = ISO(sp.from) ?? `${currentFy}-04-01`;
  const to = ISO(sp.to) ?? new Date().toISOString().slice(0, 10);

  const preview = !(await orgHasConnectors(orgId));
  const data = preview ? sampleAnalytics(from, to) : await getAnalytics(orgId, from, to);

  return <AnalyticsClient data={data} />;
}
