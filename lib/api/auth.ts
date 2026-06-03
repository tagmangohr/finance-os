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

export async function requireOrgAccess(
  orgId: string
): Promise<ApiAuthContext | AuthFailure> {
  const authClient = await createClient();

  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: org, error } = await authClient
    .from("organizations")
    .select("id, owner_id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (error || !org) {
    return {
      error: NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      ),
    };
  }

  return {
    supabase: await createServiceClient(),
    userId: user.id,
    org,
  };
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
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let query = authClient
    .from("connectors")
    .select("id, org_id, type")
    .eq("id", connectorId);

  if (options.orgId) query = query.eq("org_id", options.orgId);
  if (options.type) query = query.eq("type", options.type);

  const { data: connector, error } = await query.single();

  if (error || !connector) {
    return {
      error: NextResponse.json(
        { error: "Connector not found" },
        { status: 404 }
      ),
    };
  }

  const { data: org, error: orgError } = await authClient
    .from("organizations")
    .select("id, owner_id")
    .eq("id", connector.org_id)
    .eq("owner_id", user.id)
    .single();

  if (orgError || !org) {
    return {
      error: NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      ),
    };
  }

  return {
    supabase: await createServiceClient(),
    userId: user.id,
    org,
    connector,
  };
}
