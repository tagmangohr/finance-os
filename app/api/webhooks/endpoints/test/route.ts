import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptValue } from "@/lib/crypto/secrets";
import { buildWebhookPayload, signWebhookBody } from "@/lib/webhooks/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST ?id= → send a signed TEST event to the endpoint so the owner can confirm the
// URL + signature verification work end-to-end, without waiting for a real payment.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId || !org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = await createServiceClient();
  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret")
    .eq("id", id)
    .eq("org_id", org.id)
    .single();
  if (!ep) return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });

  const secret = decryptValue(ep.secret as string);
  const eventId = `evt_test_${Math.random().toString(36).slice(2, 12)}`;
  const payload = buildWebhookPayload({
    eventId,
    eventType: "payment.created",
    orgId: org.id,
    snapshot: {
      id: "00000000-0000-0000-0000-000000000000",
      external_id: "test_txn",
      source: "test",
      status: "completed",
      amount: 100,
      currency: "INR",
      amount_base: 100,
      category: "test",
      transaction_date: new Date().toISOString().slice(0, 10),
      counterparty_name: "Test Customer",
      metadata: { email: "test@example.com", phone: null },
    },
  });
  const body = JSON.stringify({ ...payload, test: true });
  const sig = signWebhookBody(secret, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(ep.url as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FinanceOS-Event": "payment.created",
        "X-FinanceOS-Event-Id": eventId,
        "X-FinanceOS-Delivery": eventId,
        "X-FinanceOS-Signature": sig.header,
        "User-Agent": "FinanceOS-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Request failed" });
  } finally {
    clearTimeout(timer);
  }
}
