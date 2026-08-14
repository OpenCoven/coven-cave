export type OpenCovenToolInstallTarget = "coven-cli";

export type OpenCovenToolInstallStatus = {
  id: OpenCovenToolInstallTarget;
  label: string;
  installed: boolean;
  outdated: boolean;
  compatible?: boolean;
};

const OPEN_COVEN_TOOL_ORDER: OpenCovenToolInstallTarget[] = [
  "coven-cli",
];

const OPEN_COVEN_TOOL_PACKAGES: Record<OpenCovenToolInstallTarget, string> = {
  "coven-cli": "@opencoven/cli@latest",
};

// The Coven CLI is the only REQUIRED OpenCoven tool: the wizard's tools step
// passes just the coven-cli status. Coven Code stays a valid target because
// it is still installable — as an optional runtime from the wizard's runtime
// grid and from the Settings tools panel.
const REQUIRED_TOOL: OpenCovenToolInstallTarget = "coven-cli";

export function openCovenToolActionTargets(
  tools: readonly OpenCovenToolInstallStatus[] | null,
): OpenCovenToolInstallTarget[] {
  if (tools === null) return [];
  if (tools.length === 0) return [REQUIRED_TOOL];
  const actionable = new Set(
    tools
      .filter((tool) => !tool.installed || tool.compatible === false)
      .map((tool) => tool.id),
  );
  return OPEN_COVEN_TOOL_ORDER.filter((id) => actionable.has(id));
}

export function openCovenToolsInstallCommand(
  tools: readonly OpenCovenToolInstallStatus[],
): string {
  const targets = openCovenToolActionTargets(tools);
  const packages = (targets.length > 0 ? targets : [REQUIRED_TOOL]).map(
    (target) => OPEN_COVEN_TOOL_PACKAGES[target],
  );
  return `npm i -g ${packages.join(" ")}`;
}

export function openCovenToolsPrimaryActionLabel(
  tools: readonly OpenCovenToolInstallStatus[] | null,
): string {
  if (tools === null) return "Checking local installation…";
  if (tools.length === 0) return "Install the Coven CLI";
  const actions = tools.filter((tool) =>
    openCovenToolActionTargets(tools).includes(tool.id),
  );
  if (actions.length === 0) return "Coven CLI ready";
  if (actions.length === 1) {
    const [tool] = actions;
    if (!tool.installed && tool.id === REQUIRED_TOOL) return "Install the Coven CLI";
    return `${tool.installed ? "Update" : "Install"} ${tool.label}`;
  }
  if (actions.every((tool) => !tool.installed)) return "Install OpenCoven tools";
  return "Update OpenCoven tools";
}
