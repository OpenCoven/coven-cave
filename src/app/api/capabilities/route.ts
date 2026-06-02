import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";

export const dynamic = "force-dynamic";

export type GlobalInstructions = {
  present: boolean;
  path?: string;
  byte_count?: number;
  excerpt_lines?: number;
};

export type HarnessSkill = {
  id: string;
  name: string;
  source: string;
  harness_id: string;
  path: string;
  description?: string;
  version?: string;
  tags?: string[];
};

export type HarnessPlugin = {
  id: string;
  name: string;
  source: string;
  harness_id: string;
  kind: string;
  enabled: boolean;
  transport?: string;
  command?: string;
  args?: string[];
};

export type CapabilityWarning = {
  kind: string;
  path: string;
  message: string;
};

export type HarnessCapabilityManifest = {
  harness_id: string;
  scanned_at: string;
  global_instructions: GlobalInstructions;
  skills: HarnessSkill[];
  plugins: HarnessPlugin[];
  warnings: CapabilityWarning[];
};

export type CapabilitiesResponse = {
  ok: boolean;
  coven_skills: Array<{ id: string; name: string; description?: string; version?: string; tags?: string[] }>;
  harness_capabilities: HarnessCapabilityManifest[];
  scanned_at: string;
  error?: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1" ? "?refresh=1" : "";
  const harness = url.searchParams.get("harness");

  const path = harness
    ? `/api/v1/capabilities/${encodeURIComponent(harness)}${refresh}`
    : `/api/v1/capabilities${refresh}`;

  const res = await callDaemon<CapabilitiesResponse>({ path });
  if (!res.ok || !res.data) {
    const isOffline = res.status === 0 || (res.error != null && /(ENOENT|ECONNREFUSED|ETIMEDOUT|socket|connect)/i.test(res.error));
    return NextResponse.json(
      {
        ok: false,
        error: isOffline ? 'daemon offline' : (res.error ?? `daemon http ${res.status}`),
        coven_skills: [],
        harness_capabilities: [],
        scanned_at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, coven_skills: res.data.coven_skills, harness_capabilities: res.data.harness_capabilities, scanned_at: res.data.scanned_at });
}
