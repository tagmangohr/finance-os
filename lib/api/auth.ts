import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];
type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];

export type ApiAuthContext = {
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
  userId: string;
  org: Pick<OrganizationRow, "id" | "owner_id">;
};

export type ConnectorAuthContext = ApiAuthContext & {
  connector: Pick<ConnectorRow, "id" | "org_id" | "type">;
};

type AuthFailure = {
  error: NextResponse;
};

export function isAuthFailure<T>(
  result: T | AuthFailure
): result is AuthFailure {
  return "error" in (result as AuthFailure);
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Return the org {id, owner_id} if `userId` may WRITE to it — i.e. they own it
 * OR they're an active admin member. Returns null otherwise (viewers/strangers).
 * Uses the service client so it isn't blocked by RLS while resolving access.
 */
async function getWritableOrg(
  service: ServiceClient,
  userId: string,
  orgId: string
): Promise<Pick<OrganizationRow, "id" | "owner_id"> | null> {
  const { data: org } = await service
    .from("organizations")
    .select("id, owner_id")
    .eq("id", orgId)
    .maybeSingle();

  if (!org) return null;
  if (org.owner_id === userId) return org;

  // Active admin member of this org?
  const { data: member } = await service
    .from("org_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "admin")
    .maybeSingle();

  return member ? org : null;
}

export async function requireOrgAccess(
  orgId: string
): Promise<ApiAuthContext | AuthFailure> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = await createServiceClient();
  const org = await getWritableOrg(supabase, user.id, orgId);

  if (!org) {
    return {
      error: NextResponse.json({ error: "Organization not found" }, { status: 404 }),
    };
  }

  return { supabase, userId: user.id, org };
}

export async function requireConnectorAccess(
  connectorId: string,
  options: { orgId?: string; type?: string } = {}
): Promise<ConnectorAuthContext | AuthFailure> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = await createServiceClient();

  // Service client: an admin (non-owner) can't SELECT the connector under RLS,
  // so we read it with the service role and authorize via getWritableOrg below.
  let query = supabase
    .from("connectors")
    .select("id, org_id, type")
    .eq("id", connectorId);

  if (options.orgId) query = query.eq("org_id", options.orgId);
  if (options.type) query = query.eq("type", options.type);

  const { data: connector, error } = await query.maybeSingle();

  if (error || !connector) {
    return {
      error: NextResponse.json({ error: "Connector not found" }, { status: 404 }),
    };
  }

  const org = await getWritableOrg(supabase, user.id, connector.org_id);

  if (!org) {
    return {
      error: NextResponse.json({ error: "Organization not found" }, { status: 404 }),
    };
  }

  return { supabase, userId: user.id, org, connector };
}
