import { NextResponse } from "next/server";
import { collectMemoryInspector } from "@/lib/memory-inspector";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId") ?? "main";

  try {
    const report = await collectMemoryInspector({ familiarId });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "memory inspector failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("invalid familiar id") ? 400 : 500 },
    );
  }
}
