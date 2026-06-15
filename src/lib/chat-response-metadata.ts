import type { ModelApplicationState, ModelScope } from "./chat-model-state.ts";

export type ChatResponseMetadata = {
  familiarId: string;
  harness: string;
  model: string;
  runtime: string;
  desiredModel?: string;
  confirmedModel?: string;
  modelSource?: ModelScope;
  modelApplicationState?: ModelApplicationState;
  modelApplicationReason?: string;
};

/** Collapse a user home prefix to "~" so the directory reads as a location the
 *  user can place, not a machine-specific absolute path. Matches the macOS
 *  /Users/<name> and Linux /home/<name> conventions the daemon emits. */
function homeRelative(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** Keep the path legible at header widths by left-truncating: first segment +
 *  last segment with an ellipsis between, so the meaningful repo folder
 *  survives instead of being clipped off the end. Short paths (≤2 segments)
 *  pass through whole. */
function shortenPath(p: string): string {
  const isAbs = p.startsWith("/");
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return `${isAbs ? "/" : ""}${parts[0]}/…/${parts[parts.length - 1]}`;
}

/** The conversation's `runtime` is not a "runtime" the user thinks about — it's
 *  the working directory the harness runs in. Render it as a directory:
 *  `local:<cwd>` → the cwd (home-relative, shortened); `ssh:<host>:<cwd>` →
 *  `host:<cwd>`. `label` is what shows next to the folder icon; `title` carries
 *  the full, unshortened location for the hover tooltip. */
export function formatRuntime(
  runtime?: string | null,
): { label: string; title: string } | null {
  const trimmed = runtime?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ssh:")) {
    const rest = trimmed.slice(4);
    const sep = rest.indexOf(":");
    const host = sep >= 0 ? rest.slice(0, sep) : rest;
    const cwd = sep >= 0 ? homeRelative(rest.slice(sep + 1)) : "";
    if (!cwd) return { label: host, title: `${host} (ssh)` };
    return { label: `${host}:${shortenPath(cwd)}`, title: `${host}:${cwd} (ssh)` };
  }
  const cwd = homeRelative(trimmed.startsWith("local:") ? trimmed.slice(6) : trimmed);
  return { label: shortenPath(cwd), title: cwd };
}
