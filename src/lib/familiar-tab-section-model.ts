/**
 * Shared derivation for the Familiar tab's sections (Identity / Skills / MCP /
 * Analytics / Memory). The hub (chat-familiar-capabilities.tsx) fetches one
 * capability snapshot and derives this section model once; every tab section
 * consumes the same object, so provenance math (role-granted vs familiar vs
 * global) can't drift between tabs.
 */

import type { Familiar } from "@/lib/types";
import type { RoleEntry } from "@/app/api/roles/route";
import type { LocalSkillEntry } from "@/app/api/skills/local/route";
import type { HarnessCapabilityManifest, HarnessPlugin } from "@/app/api/capabilities/route";
import type { AdapterReport } from "@/lib/harness-adapters";

/** One skill row, resolved to a single provenance for the Skills browser. */
export type FamiliarSkillRow = {
  /** Stable key — the on-disk path when known, else the skill id. */
  key: string;
  id: string;
  name: string;
  kind: string;
  description?: string;
  tags: string[];
  /** Where the grant comes from: a role name, "familiar", or "global". */
  source: string;
  sourceKind: "role" | "familiar" | "global";
  /** On-disk skill directory (feeds /api/skills/files); role grants without a
   *  local install have none. */
  path?: string;
};

export type FamiliarSectionData = {
  familiar: Familiar;
  harnessId: string;
  daemonRunning?: boolean;
  /** Roles active for this familiar (or "all"/"global" scope). */
  activeRoles: RoleEntry[];
  /** Every skill visible to this familiar, one row per grant, role grants first. */
  skillRows: FamiliarSkillRow[];
  /** Unique skill count across all provenances (what the tab badge shows). */
  skillCount: number;
  mcpPlugins: HarnessPlugin[];
  nonMcpPlugins: HarnessPlugin[];
  manifest: HarnessCapabilityManifest | null;
  harnessReport: AdapterReport | null;
  errors: string[];
};

export function deriveFamiliarSectionData(input: {
  familiar: Familiar;
  roles: RoleEntry[];
  localSkills: LocalSkillEntry[];
  harnessCapabilities: HarnessCapabilityManifest[];
  harnesses: AdapterReport[];
  errors: string[];
  daemonRunning?: boolean;
}): FamiliarSectionData {
  const { familiar } = input;
  const harnessId = familiar.harness ?? "codex";

  const activeRoles = input.roles.filter(
    (r) => r.active && (r.familiar === familiar.id || r.familiar === "all" || r.familiar === "global"),
  );

  const familiarSkills = input.localSkills.filter((s) => (s.familiar as string) === familiar.id);
  const globalSkills = input.localSkills.filter((s) => s.familiar === "global");

  // Role-granted rows resolve against the local scan for metadata; a granted
  // id with no local install still gets a row (the grant is real even when
  // the skill body is missing on this machine).
  const skillRows: FamiliarSkillRow[] = [];
  const seen = new Set<string>();
  for (const role of activeRoles) {
    for (const sid of role.skills) {
      const dedupeKey = `role:${sid}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const skill = input.localSkills.find((s) => s.id === sid);
      skillRows.push({
        key: skill?.path ?? dedupeKey,
        id: sid,
        name: skill?.name ?? sid,
        kind: skill?.kind ?? "agent",
        description: skill?.description,
        tags: skill?.tags ?? [],
        source: role.name,
        sourceKind: "role",
        path: skill?.path,
      });
    }
  }
  for (const s of familiarSkills) {
    skillRows.push({
      key: s.path,
      id: s.id,
      name: s.name,
      kind: s.kind ?? "agent",
      description: s.description,
      tags: s.tags ?? [],
      source: "familiar",
      sourceKind: "familiar",
      path: s.path,
    });
  }
  for (const s of globalSkills) {
    skillRows.push({
      key: s.path,
      id: s.id,
      name: s.name,
      kind: s.kind ?? "agent",
      description: s.description,
      tags: s.tags ?? [],
      source: "global",
      sourceKind: "global",
      path: s.path,
    });
  }

  const manifest = input.harnessCapabilities.find((m) => m.harness_id === harnessId) ?? null;
  const plugins = manifest?.plugins ?? [];
  const uniqueSkillIds = new Set([
    ...skillRows.map((row) => row.id),
    ...(manifest?.skills ?? []).map((skill) => skill.id),
  ]);

  return {
    familiar,
    harnessId,
    daemonRunning: input.daemonRunning,
    activeRoles,
    skillRows,
    skillCount: uniqueSkillIds.size,
    mcpPlugins: plugins.filter((p) => p.kind?.toLowerCase() === "mcp"),
    nonMcpPlugins: plugins.filter((p) => p.kind?.toLowerCase() !== "mcp"),
    manifest,
    harnessReport: input.harnesses.find((h) => h.id === harnessId) ?? null,
    errors: input.errors,
  };
}
