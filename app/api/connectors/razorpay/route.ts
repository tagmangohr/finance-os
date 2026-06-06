import { NextRequest, NextResponse } from "next/server";
import { handleConnectorSyncRequest } from "@/lib/api/connector-sync-route";

// Raise the Vercel function timeout so multi-page Razorpay syncs don't get cut off.
// Hobby plan caps at 10 s regardless; Pro/Enterprise honour this up to 300 s.
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleConnectorSyncRequest(req, "razorpay");
}
