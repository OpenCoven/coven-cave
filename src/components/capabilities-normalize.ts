import type { HarnessCapabilityManifest } from "@/components/capability-card";

export type CovenSkill = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
};

export type CapabilityType = "instructions" | "skill" | "plugin" | "workflow" | "role" | "mcp" | "warning";
export type CapabilityStatus = "available" | "enabled" | "disabled" | "warning";

export type CapabilityMapItem = {
  id: string;
  type: CapabilityType;
  harnessId: string;
  harnessLabel: string;
  label: string;
  status: CapabilityStatus;
  description?: string;
  sourcePath?: string;
  command?: string;
  tags?: string[];
  version?: string;
  kind?: string;
  warningMessage?: string;
  scannedAt?: string;
};

export type CapabilityHarnessSummary = {
  id: string;
  label: string;
  itemCount: number;
  warningCount: number;
  disabledCount: number;
  scannedAt: string;
};

export type CapabilitySummary = {
  harnesses: number;
  instructions: number;
  skills: number;
  plugins: number;
  workflows: number;
  roles: number;
  mcpServers: number;
  disabled: number;
  warnings: number;
};

export type CapabilitiesOperatorView = {
  items: CapabilityMapItem[];
  harnesses: CapabilityHarnessSummary[];
  summary: CapabilitySummary;
};

export type CapabilityFilters = {
  query?: string;
  harnessId?: string | null;
  types?: Set<CapabilityType>;
  status?: CapabilityStatus | "all" | null;
};

const HARNESS_LABEL: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  "coven-code": "Coven Code",
  copilot: "GitHub Copilot",
};

export function harnessLabel(id: string): string {
  return HARNESS_LABEL[id] ?? id;
}

function skillSourcePath(skillPath?: string): string | undefined {
  if (!skillPath) return undefined;
  const cleanPath = skillPath.replace(/\/+$/, "");
  const lowerPath = cleanPath.toLowerCase();
  if (lowerPath.endsWith(".md") || lowerPath.endsWith(".toml")) return cleanPath;
  if (lowerPath.includes("/.codex/automations/")) return `${cleanPath}/automation.toml`;
  return `${cleanPath}/SKILL.md`;
}

export function normalizeCapabilities({
  manifests,
  covenSkills,
}: {
  manifests: HarnessCapabilityManifest[];
  covenSkills: CovenSkill[];
}): CapabilitiesOperatorView {
  const items: CapabilityMapItem[] = [];
  const harnesses: CapabilityHarnessSummary[] = [];

  for (const manifest of manifests) {
    const label = harnessLabel(manifest.harness_id);
    const manifestItems: CapabilityMapItem[] = [];

    if (manifest.global_instructions.present) {
      manifestItems.push({
        id: `${manifest.harness_id}:instructions:global`,
        type: "instructions",
        harnessId: manifest.harness_id,
        harnessLabel: label,
        label: "Global instructions",
        status: "available",
        sourcePath: manifest.global_instructions.path,
        description:
          manifest.global_instructions.byte_count !== undefined
            ? `${(manifest.global_instructions.byte_count / 1024).toFixed(1)} KB`
            : undefined,
        scannedAt: manifest.scanned_at,
      });
    }

    for (const plugin of manifest.plugins) {
      const type = plugin.kind?.toLowerCase() === "mcp" ? "mcp" : "plugin";
      manifestItems.push({
        id: `${manifest.harness_id}:${type}:${plugin.id}`,
        type,
        harnessId: manifest.harness_id,
        harnessLabel: label,
        label: plugin.name,
        status: plugin.enabled ? "enabled" : "disabled",
        description: plugin.kind,
        command: [plugin.command, ...(plugin.args ?? [])].filter(Boolean).join(" ") || undefined,
        kind: plugin.kind,
        scannedAt: manifest.scanned_at,
      });
    }

    for (const skill of manifest.skills) {
      manifestItems.push({
        id: `${manifest.harness_id}:skill:${skill.id}`,
        type: "skill",
        harnessId: manifest.harness_id,
        harnessLabel: label,
        label: skill.name,
        status: "available",
        description: skill.description,
        sourcePath: skillSourcePath(skill.path),
        tags: skill.tags,
        version: skill.version,
        kind: skill.source,
        scannedAt: manifest.scanned_at,
      });
    }

    for (const [index, warning] of manifest.warnings.entries()) {
      manifestItems.push({
        id: `${manifest.harness_id}:warning:${index}`,
        type: "warning",
        harnessId: manifest.harness_id,
        harnessLabel: label,
        label: warning.kind,
        status: "warning",
        description: warning.message,
        sourcePath: warning.path,
        warningMessage: warning.message,
        scannedAt: manifest.scanned_at,
      });
    }

    harnesses.push({
      id: manifest.harness_id,
      label,
      itemCount:
        (manifest.global_instructions.present ? 1 : 0) +
        manifest.skills.length +
        manifest.plugins.length,
      warningCount: manifest.warnings.length,
      disabledCount: manifest.plugins.filter((plugin) => !plugin.enabled && plugin.kind?.toLowerCase() === "mcp").length,
      scannedAt: manifest.scanned_at,
    });
    items.push(...manifestItems);
  }

  for (const skill of covenSkills) {
    items.push({
      id: `coven:skill:${skill.id}`,
      type: "skill",
      harnessId: "coven",
      harnessLabel: "Coven",
      label: skill.name,
      status: "available",
      description: skill.description,
      tags: skill.tags,
      version: skill.version,
    });
  }

  const summary: CapabilitySummary = {
    harnesses: manifests.length,
    instructions: items.filter((item) => item.type === "instructions").length,
    skills: items.filter((item) => item.type === "skill").length,
    plugins: items.filter((item) => item.type === "plugin").length,
    workflows: items.filter((item) => item.type === "workflow").length,
    roles: items.filter((item) => item.type === "role").length,
    mcpServers: items.filter((item) => item.type === "mcp").length,
    disabled: items.filter((item) => item.status === "disabled").length,
    warnings: items.filter((item) => item.status === "warning").length,
  };

  return { items, harnesses, summary };
}

export function filterCapabilityItems(
  items: CapabilityMapItem[],
  filters: CapabilityFilters,
): CapabilityMapItem[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (filters.harnessId && item.harnessId !== filters.harnessId) return false;
    if (filters.types && filters.types.size > 0 && !filters.types.has(item.type)) return false;
    if (filters.status && filters.status !== "all" && item.status !== filters.status) return false;
    if (!query) return true;

    const searchable = [
      item.id,
      item.type,
      item.harnessId,
      item.harnessLabel,
      item.label,
      item.status,
      item.description,
      item.sourcePath,
      item.command,
      item.kind,
      item.version,
      ...(item.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return query.split(/\s+/).every((term) => searchable.includes(term));
  });
}
