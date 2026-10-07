import { NextResponse } from "next/server";
import { eventPlaneCapabilityFromEnv } from "@/lib/cave-event-plane-protocol";

export const dynamic = "force-dynamic";

/**
 * What the event plane offers this client (#5830). It is independent of the
 * daemon, so it answers while Coven is down. The plane is off unless
 * COVEN_CAVE_EVENT_PLANE_ENABLED=1. Each platform's rollout mode,
 * COVEN_CAVE_EVENT_WEB_MODE and COVEN_CAVE_EVENT_IOS_MODE, defaults to `off`,
 * and an unrecognized value fails closed to `off`. A client opens
 * /api/events-ws only when the plane is enabled and its own mode isn't `off`.
 */
export function GET() {
  return NextResponse.json(
    { ok: true, eventPlane: eventPlaneCapabilityFromEnv(process.env) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
