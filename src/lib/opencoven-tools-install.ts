export type OpenCovenToolInstallTarget = "coven-cli" | "coven-code";

export type OpenCovenToolInstallStatus = {
  id: OpenCovenToolInstallTarget;
  label: string;
  installed: boolean;
  outdated: boolean;
};

const OPEN_COVEN_TOOL_ORDER: OpenCovenToolInstallTarget[] = [
  "coven-cli",
  "coven-code",
];

const OPEN_COVEN_TOOL_PACKAGES: Record<OpenCovenToolInstallTarget, string> = {
  "coven-cli": "@opencoven/cli@latest",
  // Scoped package only — bare "coven-code" is a different, deprecated
  // npm package (see opencoven-tools-status.ts).
  "coven-code": "@opencoven/coven-code@latest",
};

export function openCovenToolActionTargets(
  tools: readonly OpenCovenToolInstallStatus[],
): OpenCovenToolInstallTarget[] {
  if (tools.length === 0) return [...OPEN_COVEN_TOOL_ORDER];
  const actionable = new Set(
    tools
      .filter((tool) => !tool.installed || tool.outdated)
      .map((tool) => tool.id),
  );
  return OPEN_COVEN_TOOL_ORDER.filter((id) => actionable.has(id));
}

export function openCovenToolsInstallCommand(
  tools: readonly OpenCovenToolInstallStatus[],
): string {
  const targets = openCovenToolActionTargets(tools);
  const packages = (targets.length > 0 ? targets : OPEN_COVEN_TOOL_ORDER).map(
    (target) => OPEN_COVEN_TOOL_PACKAGES[target],
  );
  return `npm i -g ${packages.join(" ")}`;
}

export function openCovenToolsPrimaryActionLabel(
  tools: readonly OpenCovenToolInstallStatus[],
): string {
  if (tools.length === 0) return "Install both tools";
  const actions = tools.filter((tool) =>
    openCovenToolActionTargets(tools).includes(tool.id),
  );
  if (actions.length === 0) return "OpenCoven tools ready";
  if (actions.length === 1) {
    const [tool] = actions;
    return `${tool.outdated ? "Update" : "Install"} ${tool.label}`;
  }
  if (actions.every((tool) => !tool.installed)) return "Install both tools";
  if (actions.every((tool) => tool.outdated)) return "Update OpenCoven tools";
  return "Update OpenCoven tools";
}
