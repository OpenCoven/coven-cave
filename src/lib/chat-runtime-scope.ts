import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";

type RuntimeScopeErrorCode =
  | "project_root_required"
  | "project_root_outside_home"
  | "project_root_not_directory"
  | "project_root_unavailable";

export class RuntimeScopeError extends Error {
  code: RuntimeScopeErrorCode;
  status = 400;

  constructor(code: RuntimeScopeErrorCode, message: string) {
    super(message);
    this.name = "RuntimeScopeError";
    this.code = code;
  }
}

type ResolveLocalRuntimeOptions = {
  homeDir?: string;
};

export type RuntimeScope =
  | {
      kind: "local";
      root: string;
      allowedProjectRoots?: string[];
      /** Per-root effective access level (keyed by the exact string in
       * `allowedProjectRoots`), so the preamble can tell the familiar which
       * granted roots are read-only vs. read+write. Roots absent from this
       * map render unannotated (legacy behavior — treated as full access). */
      projectRootAccess?: Record<string, ProjectAccessLevel>;
    }
  | { kind: "ssh"; host: string; root: string };

/** Normalize a path so Node's fs functions don't EISDIR on bare Windows
 * drive letters. "C:" -> "C:\\" on Windows; no-op elsewhere. */
function normalizePath(p: string): string {
  if (process.platform === "win32") {
    if (/^[a-zA-Z]:$/.test(p)) return p + "\\";
    // Convert forward slashes to a SINGLE backslash. The earlier replacement
    // used an escaped-backslash literal that expanded to TWO backslashes per
    // slash, producing malformed Windows paths that broke the spawn cwd and the
    // allow-list path comparison.
    return p.replace(/\//g, "\\");
  }
  return p;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (
      rel !== ".." &&
      !rel.startsWith(".." + path.sep) &&
      !path.isAbsolute(rel) &&
      !rel.split(path.sep).includes("..")
    )
  );
}

export async function resolveLocalRuntimeCwd(
  requested?: string,
  options: ResolveLocalRuntimeOptions = {},
): Promise<string> {
  const homePath = path.resolve(normalizePath(options.homeDir ?? homedir()));
  const homeRoot = await realpath(homePath);
  const trimmed = requested?.trim();
  if (!trimmed) {
    throw new RuntimeScopeError(
      "project_root_required",
      "projectRoot is required; refusing to start a homedir-scoped fallback session.",
    );
  }

  const candidate = path.resolve(normalizePath(trimmed));
  const relToHome = path.relative(homePath, candidate);
  if (
    relToHome === ".." ||
    relToHome.startsWith(".." + path.sep) ||
    path.isAbsolute(relToHome) ||
    relToHome.split(path.sep).includes("..")
  ) {
    throw new RuntimeScopeError(
      "project_root_outside_home",
      "projectRoot must resolve inside the local home directory; refusing to start a homedir-scoped fallback session.",
    );
  }

  const scopedCandidate = relToHome === "" ? homeRoot : path.join(homeRoot, relToHome);
  let resolved: string;
  try {
    // lgtm[js/path-injection] scopedCandidate is built from a home-relative path
    // validated above and is checked again after symlink resolution below.
    resolved = await realpath(scopedCandidate);
  } catch {
    throw new RuntimeScopeError(
      "project_root_unavailable",
      "projectRoot does not exist or cannot be resolved; refusing to start a homedir-scoped fallback session.",
    );
  }

  if (!isInsideRoot(homeRoot, resolved)) {
    throw new RuntimeScopeError(
      "project_root_outside_home",
      "projectRoot must resolve inside the local home directory; refusing to start a homedir-scoped fallback session.",
    );
  }

  const s = await stat(resolved).catch(() => null);
  if (!s?.isDirectory()) {
    throw new RuntimeScopeError(
      "project_root_not_directory",
      "projectRoot must be a directory; refusing to start a homedir-scoped fallback session.",
    );
  }
  return resolved;
}

export function buildRuntimeScopePreamble(scope: RuntimeScope): string {
  if (scope.kind === "local") {
    const allowedProjectRoots = uniqueAllowedProjectRoots(scope.root, scope.allowedProjectRoots);
    if (allowedProjectRoots.length > 0) {
      const access = scope.projectRootAccess;
      // Only annotate when the caller actually threaded per-root levels
      // through — omitting `projectRootAccess` keeps prior behavior (and
      // prior test expectations) byte-for-byte unchanged.
      const readOnlyRoots = access
        ? allowedProjectRoots.filter((root) => access[root] === "read")
        : [];
      return [
        "Runtime filesystem boundary:",
        "- This is the local runtime boundary for this Cave session.",
        `- Primary root: ${scope.root}`,
        "- Granted project roots:",
        ...allowedProjectRoots.map((root) => {
          const level = access?.[root];
          const suffix = level === "read" ? " (read-only)" : level === "write" ? " (read + write)" : "";
          return `  - ${root}${suffix}`;
        }),
        "- You may read, edit, create, delete, commit, push, and run commands inside the primary root and the granted project roots listed above.",
        ...(readOnlyRoots.length > 0
          ? [
              "- Roots marked (read-only) above permit reading, browsing, and chatting only — do not edit, create, delete, commit, or push inside them, and do not run shell commands there.",
            ]
          : []),
        "- Do not read, edit, create, delete, commit, push, or run commands against files outside those listed roots.",
      ].join("\n");
    }
  }

  const label = scope.kind === "ssh" ? `${scope.host}:${scope.root}` : scope.root;
  const boundary = scope.kind === "ssh"
    ? "This is the remote runtime boundary for this Cave session."
    : "This is the local runtime boundary for this Cave session.";
  return [
    "Runtime filesystem boundary:",
    `- ${boundary}`,
    `- Root: ${label}`,
    "- Do not read, edit, create, delete, commit, push, or run commands against files outside this directory.",
    "- If the user asks for work outside this boundary, ask the user to reopen or start a Cave conversation in that project's runtime instead.",
  ].join("\n");
}

function uniqueAllowedProjectRoots(primaryRoot: string, roots: string[] | undefined): string[] {
  const normalize = (value: string) => value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const primary = normalize(primaryRoot);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots ?? []) {
    const trimmed = root.trim();
    const normalized = normalize(trimmed);
    if (!normalized || normalized === primary || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(trimmed);
  }
  return unique;
}

export function buildPromptWithRuntimeScope(prompt: string, scope: RuntimeScope): string {
  const text = prompt.trim();
  const preamble = buildRuntimeScopePreamble(scope);
  return text ? `${preamble}\n\nCurrent user message:\n${text}` : preamble;
}
