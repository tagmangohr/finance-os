import { NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import {
  isAuthFailure,
  requireConnectorAccess,
  requireOrgAccess,
} from "@/lib/api/auth";
import {
  isConnectorStatus,
  isConnectorType,
  isPlainObject,
  validateConnectorConfig,
} from "@/lib/api/validation";
import { createServiceClient } from "@/lib/supabase/server";
import { enqueueBackfill, drainSyncJobs } from "@/lib/connectors/jobs";
import { isLinkConnector } from "@/lib/connectors/links";
import { fyStartISO } from "@/lib/utils";

export const maxDuration = 60;

/** Gateway/file connectors that backfill from the FY start on first connect. Link
 *  connectors (Sheets/Excel) auto-sync via their own path, so they're excluded. */
const BACKFILL_ON_CREATE = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz"];

// POST — create a new connector
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { org_id: orgId, type, name, config, status } = body;

    if (!orgId || !type || !name) {
      return NextResponse.json(
        { error: "org_id, type, name required" },
        { status: 400 }
      );
    }

    if (!isConnectorType(type)) {
      return NextResponse.json({ error: "Invalid connector type" }, { status: 400 });
    }

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 }
      );
    }

    if (status !== undefined && !isConnectorStatus(status)) {
      return NextResponse.json({ error: "Invalid connector status" }, { status: 400 });
    }

    if (config !== undefined && !isPlainObject(config)) {
      return NextResponse.json({ error: "config must be an object" }, { status: 400 });
    }

    // Validate credentials up front so a wrong/blank key fails with a clear
    // message instead of silently erroring on every sync call later.
    const configError = validateConnectorConfig(type, (config ?? {}) as Record<string, unknown>);
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 400 });
    }

    const auth = await requireOrgAccess(orgId);
    if (isAuthFailure(auth)) return auth.error;

    const { data, error } = await auth.supabase
      .from("connectors")
      .insert({
        org_id: auth.org.id,
        type,
        name: name.trim(),
        config: config ?? {},
        status: status ?? "active",
        // A new connector is "caught up to now": incremental syncs keep the
        // forward edge fresh from here, while older history is loaded on demand
        // via an explicit, parallel-chunked backfill (the Sync date-range menu).
        synced_through: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Kick off an initial full-FY backfill so a newly connected gateway starts
    // populating immediately. Without this, its first sync would be the nightly
    // cron (up to ~24h away), since there's no longer a 30-min incremental cron.
    // Best-effort: never fail connector creation if the kickoff enqueue hiccups.
    if (!isLinkConnector(type) && BACKFILL_ON_CREATE.includes(type)) {
      try {
        const svc = await createServiceClient();
        const now = new Date();
        const fyStart = new Date(`${fyStartISO(now)}T00:00:00+05:30`);
        const windows = await enqueueBackfill(svc, data, fyStart, now);
        if (windows > 0) {
          const worker = randomUUID();
          after(async () => {
            try { await drainSyncJobs(await createServiceClient(), worker); }
            catch (e) { console.error("[connectors/manage] initial drain failed:", e); }
          });
        }
      } catch (e) {
        console.error("[connectors/manage] initial backfill enqueue failed:", e);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create connector" },
      { status: 500 }
    );
  }
}

// PATCH — update existing connector
export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const body = await request.json();
    const auth = await requireConnectorAccess(id);
    if (isAuthFailure(auth)) return auth.error;

    const updates: Record<string, unknown> = {};

    if (body.config !== undefined) {
      if (!isPlainObject(body.config)) {
        return NextResponse.json({ error: "config must be an object" }, { status: 400 });
      }
      // Validate against the connector's own type (the merged config the client
      // sends). Blocks saving an invalid key on edit, same as on create.
      const configError = validateConnectorConfig(auth.connector.type, body.config);
      if (configError) {
        return NextResponse.json({ error: configError }, { status: 400 });
      }
      updates.config = body.config;
    }

    if (body.status !== undefined) {
      if (!isConnectorStatus(body.status)) {
        return NextResponse.json({ error: "Invalid connector status" }, { status: 400 });
      }
      updates.status = body.status;
    }

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { error: "name must be a non-empty string" },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("connectors")
      .update(updates)
      .eq("id", id)
      .eq("org_id", auth.org.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update connector" },
      { status: 500 }
    );
  }
}

// DELETE — remove a connector and its associated transactions.
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const auth = await requireConnectorAccess(id);
    if (isAuthFailure(auth)) return auth.error;

    const { error: txErr } = await auth.supabase
      .from("transactions")
      .delete()
      .eq("connector_id", id)
      .eq("org_id", auth.org.id);

    if (txErr) {
      return NextResponse.json(
        { error: `Could not remove transactions: ${txErr.message}` },
        { status: 500 }
      );
    }

    const { error } = await auth.supabase
      .from("connectors")
      .delete()
      .eq("id", id)
      .eq("org_id", auth.org.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete connector" },
      { status: 500 }
    );
  }
}
