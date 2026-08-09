export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgId } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { IntelligenceClient } from "./intelligence-client";

// Server gate: Intelligence is a first-class access-controlled page. A restricted
// member without the "intelligence" grant is redirected to their first allowed
// page (never loops). The interactive chat lives in the client component.
export default async function IntelligencePage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("intelligence");

  return (
    <Suspense fallback={null}>
      <IntelligenceClient />
    </Suspense>
  );
}
