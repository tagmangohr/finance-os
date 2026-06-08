import { type NextRequest } from "next/server";
import { runConnectorSync } from "@/lib/api/run-connector-sync";

/** GET /api/cron/sync — runs at :00 every hour (Vercel cron: 0 * * * *) */
export async function GET(req: NextRequest) {
  return runConnectorSync(req);
}
