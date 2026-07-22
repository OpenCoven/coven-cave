import { NextResponse } from "next/server";
import { loadTailscaleDevices } from "@/lib/server/tailscale-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadTailscaleDevices();
  return NextResponse.json(result);
}
