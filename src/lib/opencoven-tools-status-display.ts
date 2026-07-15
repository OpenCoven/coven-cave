export type LatestCheckDisplay =
  | {
      status: "verified";
      checkedAt: string;
      latest: string;
    }
  | {
      status: "failed";
      checkedAt: string;
      error:
        | "npm_unavailable"
        | "runtime_error"
        | "timeout"
        | "registry_error"
        | "malformed_version";
    };

export type OpenCovenToolDisplayStatus = {
  installed: boolean;
  current: string | null;
  latest: string | null;
  outdated: boolean;
  compatible: boolean;
  packageVerified?: boolean;
  latestCheck?: LatestCheckDisplay;
};

export function hasVerifiedLatestVersion(tool: OpenCovenToolDisplayStatus): boolean {
  return tool.latestCheck?.status === "verified" && Boolean(tool.latest);
}

export function formatToolCheckedAt(checkedAt: string | undefined): string {
  if (!checkedAt) return "check time unavailable";
  const date = new Date(checkedAt);
  return Number.isNaN(date.getTime()) ? "check time unavailable" : date.toLocaleString();
}

function latestCheckFailureReason(tool: OpenCovenToolDisplayStatus): string {
  switch (tool.latestCheck?.status === "failed" ? tool.latestCheck.error : undefined) {
    case "npm_unavailable":
      return "npm unavailable";
    case "runtime_error":
      return "local Node/npm runtime failed";
    case "timeout":
      return "timed out";
    case "malformed_version":
      return "invalid npm response";
    default:
      return "registry lookup failed";
  }
}

export function latestCheckText(tool: OpenCovenToolDisplayStatus, stale = false): string {
  const checkedAt = formatToolCheckedAt(tool.latestCheck?.checkedAt);
  if (stale) return `Couldn't verify latest version; showing stale data from ${checkedAt}`;
  if (!hasVerifiedLatestVersion(tool)) {
    return `Couldn't verify latest version (${latestCheckFailureReason(tool)}; checked ${checkedAt})`;
  }
  return `Latest version verified with npm at ${checkedAt}`;
}

export function toolStatusText(tool: OpenCovenToolDisplayStatus, stale = false): string {
  if (!tool.installed) return "Not found";
  if (tool.packageVerified === false) return "Unexpected executable";
  if (!tool.current) return "Version probe failed";
  if (!tool.compatible) return "Needs update";
  if (stale || !hasVerifiedLatestVersion(tool)) return "Couldn't verify latest version";
  if (tool.outdated) return "Update available";
  return "Up to date";
}

export function toolFooterStatusText({
  tools,
  checking,
  error,
  stale,
}: {
  tools: OpenCovenToolDisplayStatus[];
  checking: boolean;
  error: string | null;
  stale: boolean;
}): string {
  if (error) {
    return stale && tools.length > 0
      ? `Latest tool data is stale; re-check failed: ${error}`
      : `Check failed: ${error}`;
  }
  if (checking) return "Checking tools...";
  if (tools.some((tool) => !hasVerifiedLatestVersion(tool))) {
    return "Latest version couldn't be verified for one or more tools.";
  }
  const latestCheckedAt = tools
    .map((tool) => tool.latestCheck?.checkedAt)
    .filter((checkedAt): checkedAt is string => Boolean(checkedAt))
    .sort()
    .at(-1);
  return latestCheckedAt
    ? `Latest versions verified with npm at ${formatToolCheckedAt(latestCheckedAt)}`
    : "No tool version data available";
}
