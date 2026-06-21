import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { scanClaudeUserSkills } from "@/lib/server/skill-scan";

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

/**
 * The daemon's claude scanner misses locally-installed skills whose folders
 * are symlinks (and doesn't always scan ~/.claude/skills at all), so the
 * claude manifest can report skills: [] while the harness genuinely has
 * them. Merge in our own user-skills scan; daemon-reported entries win.
 */
async function supplementClaudeSkills(manifest: HarnessCapabilityManifest): Promise<HarnessCapabilityManifest> {
  if (manifest.harness_id !== "claude") return manifest;
  try {
    const userSkills = await scanClaudeUserSkills();
    if (userSkills.length === 0) return manifest;
    const byId = new Map(userSkills.map((s) => [s.id, s]));
    // The daemon's manifest skills carry no usable description (its scanner
    // either omits it or, for a `description: |` block scalar, reports the bare
    // "|"/">" indicator), so the inspector's Detail row was blank. Backfill it
    // (and tags) from our own SKILL.md frontmatter scan in those cases.
    const enriched = manifest.skills.map((s) => {
      const current = s.description?.trim();
      if (current && current !== "|" && current !== ">") return s;
      const local = byId.get(s.id);
      if (!local?.description) return s;
      return { ...s, description: local.description, tags: s.tags?.length ? s.tags : local.tags };
    });
    const seen = new Set(manifest.skills.map((s) => s.id));
    const supplemental: HarnessSkill[] = userSkills
      .filter((s) => !seen.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        source: "local-scan",
        harness_id: "claude",
        path: s.path,
        description: s.description,
        version: s.version,
        tags: s.tags,
      }));
    return { ...manifest, skills: [...enriched, ...supplemental] };
  } catch {
    return manifest;
  }
}

function isManifest(data: unknown): data is HarnessCapabilityManifest {
  return Boolean(data && typeof data === "object" && "harness_id" in data && Array.isArray((data as HarnessCapabilityManifest).skills));
}

async function fetchHarnessManifest(harness: string, refresh: string): Promise<HarnessCapabilityManifest | null> {
  const res = await callDaemon<HarnessCapabilityManifest>({
    path: `/api/v1/capabilities/${encodeURIComponent(harness)}${refresh}`,
  });
  if (!res.ok || !isManifest(res.data)) return null;
  return supplementClaudeSkills(res.data);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1" ? "?refresh=1" : "";
  const harness = url.searchParams.get("harness");

  if (harness) {
    const res = await callDaemon<HarnessCapabilityManifest>({
      path: `/api/v1/capabilities/${encodeURIComponent(harness)}${refresh}`,
    });
    if (res.ok && isManifest(res.data)) {
      const manifest = await supplementClaudeSkills(res.data);
      return NextResponse.json({ ok: true, coven_skills: [], harness_capabilities: [manifest], scanned_at: manifest.scanned_at });
    }
    // The daemon may be up but simply have no manifest for this harness —
    // e.g. openclaw ships as its own CLI flow, not a daemon-scanned harness.
    // Only report "daemon offline" when the socket is genuinely unreachable;
    // otherwise say so accurately so the UI doesn't blame an outage.
    const offline = res.status === 0 || (res.error != null && /(ENOENT|ECONNREFUSED|ETIMEDOUT|socket|connect)/i.test(res.error));
    return NextResponse.json(
      {
        ok: false,
        error: offline ? "daemon offline" : `no capabilities manifest for harness "${harness}"`,
        coven_skills: [],
        harness_capabilities: [],
        scanned_at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  // Newer daemons repurposed the aggregate /api/v1/capabilities for
  // control-plane capability descriptors, so try it first for the legacy
  // manifest shape and otherwise assemble the aggregate ourselves from the
  // per-harness endpoints (which still serve manifests).
  const aggregate = await callDaemon<CapabilitiesResponse>({ path: `/api/v1/capabilities${refresh}` });
  if (aggregate.ok && Array.isArray(aggregate.data?.harness_capabilities)) {
    const manifests = await Promise.all(aggregate.data.harness_capabilities.map(supplementClaudeSkills));
    return NextResponse.json({
      ok: true,
      coven_skills: aggregate.data.coven_skills ?? [],
      harness_capabilities: manifests,
      scanned_at: aggregate.data.scanned_at ?? new Date().toISOString(),
    });
  }

  const harnessIds = COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id);
  const [manifestResults, covenSkillsRes] = await Promise.all([
    Promise.all(harnessIds.map((id) => fetchHarnessManifest(id, refresh))),
    callDaemon<{ id: string; name: string; description?: string; version?: string; tags?: string[] }[]>({ path: "/api/v1/skills" }),
  ]);
  const manifests = manifestResults.filter((m): m is HarnessCapabilityManifest => m !== null);

  if (manifests.length === 0) {
    const isOffline = aggregate.status === 0 || (aggregate.error != null && /(ENOENT|ECONNREFUSED|ETIMEDOUT|socket|connect)/i.test(aggregate.error));
    return NextResponse.json(
      {
        ok: false,
        error: isOffline ? "daemon offline" : (aggregate.error ?? `daemon http ${aggregate.status}`),
        coven_skills: [],
        harness_capabilities: [],
        scanned_at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    coven_skills: covenSkillsRes.ok && Array.isArray(covenSkillsRes.data) ? covenSkillsRes.data : [],
    harness_capabilities: manifests,
    scanned_at: manifests[0]?.scanned_at ?? new Date().toISOString(),
  });
}
