import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { probeOnboardingPrerequisites } from "@/lib/server/onboarding-prerequisite-probes";
import type { PrerequisiteCapability } from "@/lib/onboarding-prerequisites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CAPABILITIES = new Set<PrerequisiteCapability>([
  "local-familiar", "runtime", "queue", "project-search", "github", "remote-familiar", "phone-handoff", "developer-mobile",
]);

/** Read-only prerequisite preflight. Installer work is deliberately kept on a
 * separate explicitly-confirmed route. */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const raw = new URL(req.url).searchParams.get("capabilities") ?? "local-familiar";
  const capabilities = raw.split(",").map((value) => value.trim()).filter((value): value is PrerequisiteCapability => CAPABILITIES.has(value as PrerequisiteCapability));
  return NextResponse.json({ ok: true, prerequisites: await probeOnboardingPrerequisites(capabilities) });
}
