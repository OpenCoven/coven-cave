import { NextResponse } from "next/server";
import { APP_BUILD_REVISION, APP_VERSION } from "@/lib/app-version";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    service: "CovenCave",
    version: APP_VERSION,
    revision: APP_BUILD_REVISION,
    protocol: {
      name: "coven-cave-native-readiness",
      version: 1,
    },
    runtime: {
      bundle: process.env.COVEN_CAVE_BUNDLE === "1",
      api: "ready",
    },
  });
}
