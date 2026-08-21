export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getOrgId, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { getPnl, samplePnl, fyStartForDate, type PnlMode, type PnlParams } from "@/lib/pnl";
import { PnlClient } from "./pnl-client";

const ISO = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; fy?: string; from?: string; to?: string }>;
}) {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("pnl");

  const sp = await searchParams;
  const currentFy = fyStartForDate(new Date());
  const parsed = Number(sp.fy);
  const fyStart = Number.isFinite(parsed) && parsed >= 2020 && parsed <= currentFy ? parsed : currentFy;
  const mode: PnlMode = sp.mode === "annual" || sp.mode === "custom" || sp.mode === "quarterly" ? sp.mode : "monthly";

  // Custom range defaults to the current FY-to-date if params are missing/invalid.
  const from = ISO(sp.from) ?? `${currentFy}-04-01`;
  const to = ISO(sp.to) ?? new Date().toISOString().slice(0, 10);

  const params: PnlParams = { mode, fyStart, from, to, years: 5 };

  const preview = !(await orgHasConnectors(orgId));
  const data = preview ? samplePnl(params) : await getPnl(orgId, params);

  const years: number[] = [];
  for (let y = currentFy; y >= Math.max(2021, currentFy - 6); y--) years.push(y);

  return <PnlClient data={data} orgId={orgId} years={years} />;
}
