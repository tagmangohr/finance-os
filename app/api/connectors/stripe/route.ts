import { NextRequest, NextResponse } from "next/server";
import { handleConnectorSyncRequest } from "@/lib/api/connector-sync-route";

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleConnectorSyncRequest(req, "stripe");
}
