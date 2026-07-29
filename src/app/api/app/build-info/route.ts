import { NextResponse } from "next/server";
import { APP_BUILD_IDENTITY, APP_BUILD_REVISION, APP_VERSION } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/** Public, value-free artifact identity for support and packaged-runtime smoke checks. */
export async function GET() {
  return NextResponse.json({
    name: "CovenCave",
    version: APP_VERSION,
    revision: APP_BUILD_REVISION,
    identity: APP_BUILD_IDENTITY,
  });
}
