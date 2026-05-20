import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// POST — create a new connector
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { org_id, type, name, config, status } = body;

    if (!org_id || !type || !name) {
      return NextResponse.json({ error: "org_id, type, name required" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("connectors")
      .insert({ org_id, type, name, config: config ?? {}, status: status ?? "active" })
      .select()
      .single();

    if (error) throw error;

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
    const supabase = await createServiceClient();

    const updates: Record<string, unknown> = {};
    if (body.config !== undefined) updates.config = body.config;
    if (body.status !== undefined) updates.status = body.status;
    if (body.name !== undefined) updates.name = body.name;

    const { data, error } = await supabase
      .from("connectors")
      .update(updates)
      .eq("id", id)
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

// DELETE — remove a connector
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const supabase = await createServiceClient();

    const { error } = await supabase.from("connectors").delete().eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete connector" },
      { status: 500 }
    );
  }
}
