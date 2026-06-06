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
      .order("created_at", { ascending: true }),

    supabase
      .from("drive_connections")
      .select("*, drive_folders(*, drive_files(*))")
      .eq("org_id", org.id)
      .order("created_at", { ascending: true }),
  ]);

  // Scrub access tokens before passing to client
  const safeDriveConnections = (driveConnections ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ access_token: _a, refresh_token: _r, ...rest }) => rest
  );

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="animate-enter">
        <h1 className="text-xl font-bold text-white/85">Connectors</h1>
        <p className="text-sm text-white/30 mt-0.5">
          Connect payment gateways, accounting tools, and cloud storage — multiple accounts per source supported
        </p>
      </div>

      {/* ── API / key-based connectors ──────────────────────────────────── */}
      <ConnectorsClient orgId={org.id} connectors={connectors ?? []} />

      {/* ── Cloud Drive connectors ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-white/[0.05]" />
          <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-white/20">
            Cloud Storage
          </span>
          <div className="flex-1 h-px bg-white/[0.05]" />
        </div>
        <p className="text-xs text-white/25 mb-4">
          Store your raw transaction data as CSV/Excel files in Google Drive or OneDrive.
          Finance OS will fetch them automatically, normalise each spreadsheet with AI, and keep them in sync.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <DriveConnectors orgId={org.id} initialConnections={safeDriveConnections as Parameters<typeof DriveConnectors>[0]["initialConnections"]} />
        </div>
      </div>
    </div>
  );
}
