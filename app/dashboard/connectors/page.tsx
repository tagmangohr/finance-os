export const dynamic = 'force-dynamic';

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { generateSyncToken } from "@/lib/api/sync-token";
import { redactConnector } from "@/lib/connectors/secret-fields";
import { ConnectorsClient } from "./connectors-client";
import { DriveConnectors } from "./drive-client";

export default async function ConnectorsPage() {
  const supabase = await createClient();

  // Connectors are scoped to the ACTIVE org — switching orgs in the sidebar
  // swaps which connectors show here.
  const { userId, org } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!org) redirect("/onboarding");

  // ── Fetch API-key connectors + drive connections in parallel ───────────────
  const [{ data: connectors }, { data: driveConnections }] = await Promise.all([
    supabase
      .from("connectors")
      .select("*")
      .eq("org_id", org.id)
      .not("type", "in", '("google_drive","onedrive")')
      .order("created_at", { ascending: true }),

    supabase
      .from("drive_connections")
      .select("*, drive_folders(*, drive_files(*))")
      .eq("org_id", org.id)
      .order("created_at", { ascending: true }),
  ]);

  // Scrub OAuth tokens before passing to client component
  const safeDriveConnections = (driveConnections ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ access_token: _a, refresh_token: _r, ...rest }) => rest
  );

  // Generate a short-lived HMAC token per connector.
  // These are verified locally in the sync API route — no Supabase auth
  // round-trip needed per chunk, eliminating the main cause of 504 timeouts.
  const syncTokens: Record<string, string> = {};
  for (const c of connectors ?? []) {
    syncTokens[c.id] = generateSyncToken(c.id, org.id);
  }

  return (
    <ConnectorsClient orgId={org.id} connectors={(connectors ?? []).map(redactConnector)} syncTokens={syncTokens}>
      <Suspense fallback={null}>
        <DriveConnectors
          orgId={org.id}
          initialConnections={
            safeDriveConnections as Parameters<typeof DriveConnectors>[0]["initialConnections"]
          }
        />
      </Suspense>
    </ConnectorsClient>
  );
}
