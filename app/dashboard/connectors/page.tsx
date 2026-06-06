export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConnectorsClient } from "./connectors-client";
import { DriveConnectors } from "./drive-client";

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

  return (
    <ConnectorsClient orgId={org.id} connectors={connectors ?? []}>
      <DriveConnectors
        orgId={org.id}
        initialConnections={
          safeDriveConnections as Parameters<typeof DriveConnectors>[0]["initialConnections"]
        }
      />
    </ConnectorsClient>
  );
}
