import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type RuntimeScopeErrorCode =
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
  | { kind: "local"; root: string }
  | { kind: "ssh"; host: string; root: string };

/** Normalize a path so Node's fs functions don't EISDIR on bare Windows
 * drive letters. "C:" -> "C:\\" on Windows; no-op elsewhere. */
function normalizePath(p: string): string {
  if (process.platform === "win32") {
    if (/^[a-zA-Z]:$/.test(p)) return p + "\\";
    return p.replace(/\//g, "\\\\");
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
  if (!trimmed) return homeRoot;

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

export function buildPromptWithRuntimeScope(prompt: string, scope: RuntimeScope): string {
  const text = prompt.trim();
  const preamble = buildRuntimeScopePreamble(scope);
  return text ? `${preamble}\n\nCurrent user message:\n${text}` : preamble;
}
