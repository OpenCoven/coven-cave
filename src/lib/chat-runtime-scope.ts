import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ProjectAccessLevel } from "@/lib/project-access-levels";
import { realpathNativeOrResolve } from "./server/canonical-path.ts";

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
  rootAuthority?: "home" | "authorized-project";
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
      /** Narrow instruction/asset roots advertised by the runtime. These are
       * readable so a skill can be followed, but never writable project roots. */
      readOnlyResourceRoots?: string[];
    }
  | { kind: "ssh"; host: string; root: string };

export type RuntimeAccessFingerprintInput = {
  primaryRoot: string;
  permissionMode?: "read" | "full";
  readOnlyResourceRoots?: readonly string[];
  grantedProjectRoots: readonly string[];
  projectRootAccess?: Readonly<Record<string, ProjectAccessLevel>>;
  additionalRoots?: readonly string[];
};

function canonicalFingerprintRoot(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Stable identity for the filesystem authority handed to one native harness
 * session. Prompt text is rebuilt on every turn, but several harnesses pin
 * their process sandbox when the native session is first created. Persisting
 * this value lets chat detect a later human grant and replace that stale
 * native session instead of repeatedly describing access the process lacks.
 */
export function buildRuntimeAccessFingerprint(input: RuntimeAccessFingerprintInput): string {
  const primaryRoot = canonicalFingerprintRoot(input.primaryRoot);
  const roots = new Map<string, ProjectAccessLevel>();
  for (const root of input.additionalRoots ?? []) {
    const canonical = canonicalFingerprintRoot(root);
    if (canonical && canonical !== primaryRoot) roots.set(canonical, "write");
  }
  for (const root of input.grantedProjectRoots) {
    const canonical = canonicalFingerprintRoot(root);
    if (!canonical || canonical === primaryRoot) continue;
    roots.set(canonical, input.projectRootAccess?.[root] ?? "write");
  }
  return JSON.stringify({
    version: 2,
    primaryRoot,
    permissionMode: input.permissionMode === "read" ? "read" : "full",
    readOnlyResourceRoots: [...new Set((input.readOnlyResourceRoots ?? [])
      .map(canonicalFingerprintRoot).filter(Boolean))].sort(),
    roots: [...roots.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([root, access]) => ({ root, access })),
  });
}

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

/**
 * The directories a local harness receives as `--add-dir` grants: the granted
 * project roots and the familiar workspace, minus the spawn root the harness
 * already trusts as its cwd, one grant per directory. Forwarded roots keep
 * their registered spelling.
 *
 * The spawn root arrives realpathed from {@link resolveLocalRuntimeCwd}, while
 * a granted root keeps the spelling it was registered under, so directories
 * are compared by canonical identity: a project registered through an alias of
 * the spawn directory (macOS `/tmp -> /private/tmp`, another letter case on a
 * case-insensitive volume; #6210) is not handed back to the harness as a
 * second grant of its own cwd.
 */
export function runtimeGrantDirs(input: {
  spawnRoot: string;
  grantedProjectRoots: readonly string[];
  projectRootAccess?: Readonly<Record<string, ProjectAccessLevel>>;
  familiarWorkspace?: string;
}): string[] {
  const seen = new Set([realpathNativeOrResolve(input.spawnRoot)]);
  const dirs: string[] = [];
  for (const candidate of [
    ...input.grantedProjectRoots.filter((root) =>
      !input.projectRootAccess || input.projectRootAccess[root] === "write"
    ),
    ...(input.familiarWorkspace ? [input.familiarWorkspace] : []),
  ]) {
    const root = candidate.trim();
    if (!root || root === input.spawnRoot) continue;
    const identity = realpathNativeOrResolve(root);
    if (seen.has(identity)) continue;
    seen.add(identity);
    dirs.push(root);
  }
  return dirs;
}

export async function resolveLocalRuntimeCwd(
  requested?: string,
  options: ResolveLocalRuntimeOptions = {},
): Promise<string> {
  const authorizedProjectRoot = options.rootAuthority === "authorized-project";
  const homePath = path.resolve(/* turbopackIgnore: true */ normalizePath(options.homeDir ?? homedir()));
  const homeRoot = await realpath(/* turbopackIgnore: true */ homePath);
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
    !authorizedProjectRoot &&
    (
      relToHome === ".." ||
      relToHome.startsWith(".." + path.sep) ||
      path.isAbsolute(relToHome) ||
      relToHome.split(path.sep).includes("..")
    )
  ) {
    throw new RuntimeScopeError(
      "project_root_outside_home",
      "projectRoot must resolve inside the local home directory; refusing to start a homedir-scoped fallback session.",
    );
  }

  const scopedCandidate = authorizedProjectRoot
    ? candidate
    : relToHome === ""
      ? homeRoot
      : path.join(homeRoot, relToHome);
  let resolved: string;
  try {
    // lgtm[js/path-injection] home-scoped candidates are containment-checked
    // above and below; authorized project roots already passed the route's
    // registration and familiar-access gate.
    resolved = await realpath(scopedCandidate);
  } catch {
    throw new RuntimeScopeError(
      "project_root_unavailable",
      "projectRoot does not exist or cannot be resolved; refusing to start a homedir-scoped fallback session.",
    );
  }

  if (!authorizedProjectRoot && !isInsideRoot(homeRoot, resolved)) {
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
    const readOnlyResourceRoots = uniqueAllowedProjectRoots(scope.root, scope.readOnlyResourceRoots);
    if (allowedProjectRoots.length > 0 || readOnlyResourceRoots.length > 0) {
      const access = scope.projectRootAccess;
      // Only annotate when the caller actually threaded per-root levels
      // through — omitting `projectRootAccess` keeps prior behavior (and
      // prior test expectations) byte-for-byte unchanged.
      const readOnlyRoots = access
        ? allowedProjectRoots.filter(({ spellings }) => mergedAccessLevel(spellings, access) === "read")
        : [];
      return [
        "Runtime filesystem boundary:",
        "- This is the local runtime boundary for this Cave session.",
        `- Primary root: ${scope.root}`,
        ...(allowedProjectRoots.length > 0
          ? [
              "- Granted project roots:",
              ...allowedProjectRoots.map(({ root, spellings }) => {
                const level = mergedAccessLevel(spellings, access);
                const suffix = level === "read" ? " (read-only)" : level === "write" ? " (read + write)" : "";
                // Name the directory by a spelling that holds the level shown.
                const shown = (level && spellings.find((spelling) => access?.[spelling] === level)) || root;
                return `  - ${shown}${suffix}`;
              }),
            ]
          : []),
        ...(readOnlyResourceRoots.length > 0
          ? [
              "- Read-only runtime resources:",
              ...readOnlyResourceRoots.map(({ root }) => `  - ${root} (read-only)`),
            ]
          : []),
        allowedProjectRoots.length > 0
          ? "- You may read, edit, create, delete, commit, push, and run commands inside the primary root and the granted project roots listed above."
          : "- You may read, edit, create, delete, commit, push, and run commands inside the primary root.",
        ...(readOnlyRoots.length > 0
          ? [
              "- Roots marked (read-only) above permit reading, browsing, and chatting only — do not edit, create, delete, commit, or push inside them, and do not run shell commands there.",
            ]
          : []),
        ...(readOnlyResourceRoots.length > 0
          ? [
              "- Runtime resources are read-only — read their instructions and assets, but do not edit, create, delete, commit, push, or run commands inside them.",
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

// One entry per directory, compared by on-disk identity so an alias of the
// primary root or a second spelling of a grant is not listed again (#6216).
// Each entry keeps its first registered spelling and every spelling that named
// the same directory, so per-root access levels can still be looked up.
function uniqueAllowedProjectRoots(
  primaryRoot: string,
  roots: string[] | undefined,
): Array<{ root: string; spellings: string[] }> {
  const normalize = (value: string) => value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const primary = normalize(primaryRoot);
  const primaryIdentity = realpathNativeOrResolve(primaryRoot.trim());
  const byIdentity = new Map<string, { root: string; spellings: string[] }>();
  for (const root of roots ?? []) {
    const trimmed = root.trim();
    const normalized = normalize(trimmed);
    if (!normalized || normalized === primary) continue;
    const identity = realpathNativeOrResolve(trimmed);
    if (identity === primaryIdentity) continue;
    const entry = byIdentity.get(identity);
    if (entry) entry.spellings.push(trimmed);
    else byIdentity.set(identity, { root: trimmed, spellings: [trimmed] });
  }
  return [...byIdentity.values()];
}

// Spellings of one directory merge to the most permissive level: every granted
// root is forwarded to the harness, read grants included, so a directory that
// any grant makes writable is writable for this session.
function mergedAccessLevel(
  spellings: string[],
  access: Record<string, ProjectAccessLevel> | undefined,
): ProjectAccessLevel | undefined {
  const levels = spellings.map((spelling) => access?.[spelling]);
  if (levels.includes("write")) return "write";
  if (levels.includes("read")) return "read";
  return undefined;
}

export function buildPromptWithRuntimeScope(prompt: string, scope: RuntimeScope): string {
  const text = prompt.trim();
  const preamble = buildRuntimeScopePreamble(scope);
  return text ? `${preamble}\n\nCurrent user message:\n${text}` : preamble;
}
