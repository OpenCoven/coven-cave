export type OpenCovenToolState =
  | "missing"
  | "version-unreadable"
  | "below-minimum"
  | "outdated"
  | "current"
  | "latest-unknown";

export type OpenCovenToolAction = "install" | "repair" | "update";

export type OpenCovenToolStateInput = {
  installed: boolean;
  current: string | null;
  latest: string | null;
  outdated: boolean;
  compatible: boolean;
  minimumVersion: string;
};

export type OpenCovenToolPresentation = {
  state: OpenCovenToolState;
  versionText: string;
  statusText: string;
  action: OpenCovenToolAction | null;
};

/**
 * Keep tool state truthy and mutually exclusive. In particular, a path alone
 * only proves that we found a binary: it must never be treated as current or
 * compatible until its version probe succeeds.
 */
export function openCovenToolState(
  tool: OpenCovenToolStateInput,
): OpenCovenToolState {
  if (!tool.installed) return "missing";
  if (!tool.current) return "version-unreadable";
  if (!tool.compatible) return "below-minimum";
  if (!tool.latest) return "latest-unknown";
  if (tool.outdated) return "outdated";
  return "current";
}

export function openCovenToolPresentation(
  tool: OpenCovenToolStateInput,
): OpenCovenToolPresentation {
  const state = openCovenToolState(tool);
  switch (state) {
    case "missing":
      return {
        state,
        versionText: "Not installed",
        statusText: "Not found — install it to use it.",
        action: "install",
      };
    case "version-unreadable":
      return {
        state,
        versionText: "Found, version unreadable",
        statusText: "Version unreadable — repair or reinstall it.",
        action: "repair",
      };
    case "below-minimum":
      return {
        state,
        versionText: tool.current ?? "Version unreadable",
        statusText: `Below Cave's minimum — requires >= ${tool.minimumVersion}.`,
        action: "update",
      };
    case "outdated":
      return {
        state,
        versionText: `${tool.current} → ${tool.latest}`,
        statusText: "Update available.",
        action: "update",
      };
    case "latest-unknown":
      return {
        state,
        versionText: tool.current ?? "Version unreadable",
        statusText: "npm latest is unavailable. Check again later.",
        action: null,
      };
    case "current":
      return {
        state,
        versionText: tool.current ?? "Version unreadable",
        statusText: "Current and compatible.",
        action: null,
      };
  }
}

export function openCovenToolActionLabel(
  action: OpenCovenToolAction,
  label: string,
): string {
  const verb = action === "install" ? "Install" : action === "repair" ? "Repair" : "Update";
  return `${verb} ${label}`;
}
