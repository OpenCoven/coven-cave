import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rm, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import type { ProjectAccessLevel } from "./project-access-levels.ts";

export type ClaudeWriteScope = {
  version: 2;
  primaryRoot: string;
  writableRoots: string[];
  readOnlyRoots: string[];
  protectedRoots: string[];
  mcpConfigFile?: string;
  mcpServerNames?: string[];
};

type ClaudeMcpServer = Record<string, unknown>;
type ClaudeMcpServers = Record<string, ClaudeMcpServer>;

export function buildClaudeWriteScope(input: {
  primaryRoot: string;
  primaryAccess: ProjectAccessLevel;
  grantedProjectRoots: readonly string[];
  projectRootAccess: Readonly<Record<string, ProjectAccessLevel>>;
  familiarWorkspace?: string;
  protectedRoots: readonly string[];
}): ClaudeWriteScope {
  if (input.primaryAccess === "read") throw new Error("This project's grant is read-only. Use Read-only mode or request write access.");
  if (input.primaryAccess !== "write") throw new Error("Explicit primary-root write access is required.");
  const canonical = (root: string) => realpathSync.native(/* turbopackIgnore: true */ root);
  const primaryRoot = canonical(input.primaryRoot);
  const writable = new Set([primaryRoot]);
  const readable = new Set<string>();
  for (const root of input.grantedProjectRoots) {
    const level = input.projectRootAccess[root];
    if (level === "write") writable.add(canonical(root));
    else if (level === "read") readable.add(canonical(root));
  }
  if (input.familiarWorkspace) writable.add(canonical(input.familiarWorkspace));
  return {
    version: 2, primaryRoot,
    writableRoots: [...writable].sort(),
    readOnlyRoots: [...readable].filter(root => !writable.has(root)).sort(),
    protectedRoots: [...new Set(input.protectedRoots.map(canonical))].sort(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(/* turbopackIgnore: true */ root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function readJsonRecord(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read ${path.basename(file)}, so its MCP servers are left out of this turn.`);
    }
    return {};
  }
}

const isStringList = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string");

function isUsableServer(server: unknown): server is ClaudeMcpServer {
  if (!isRecord(server)) return false;
  if (typeof server.command === "string") {
    return (server.args === undefined || isStringList(server.args))
      && (server.env === undefined || (isRecord(server.env) && isStringList(Object.values(server.env))));
  }
  return typeof server.url === "string" && (server.headersHelper === undefined || typeof server.headersHelper === "string");
}

function usableServers(servers: unknown, disabled: unknown): ClaudeMcpServers {
  if (!isRecord(servers)) return {};
  const disabledNames = new Set(Array.isArray(disabled) ? disabled : []);
  const usable: ClaudeMcpServers = {};
  let malformed = 0;
  for (const [name, server] of Object.entries(servers)) {
    if (disabledNames.has(name)) continue;
    if (/^[A-Za-z0-9_-]+$/.test(name) && isUsableServer(server)) usable[name] = server;
    else malformed += 1;
  }
  if (malformed) console.warn(`Left out ${malformed} malformed MCP server ${malformed === 1 ? "entry" : "entries"}.`);
  return usable;
}

/**
 * Owner-configured MCP servers for one familiar, from Claude's user and
 * per-workspace entries and the familiar workspace's `.mcp.json`, in Claude's
 * own order: a per-workspace entry beats the workspace file, which beats user
 * scope. Claude's sandbox refuses writes to `.mcp.json` and `.claude.json`, so a
 * familiar can't add its own server. A project repository's `.mcp.json` is never
 * read, even when the workspace sits inside one: repository content must not be
 * able to start a process outside the sandbox. This launch runs under another
 * project's key in Claude's config, so the workspace's disable lists are applied
 * here or not at all.
 */
export async function loadClaudeFamiliarMcpServers(input: {
  familiarWorkspace?: string;
  projectRoots?: readonly string[];
  configDir?: string;
}): Promise<ClaudeMcpServers> {
  // Not `??`: an empty value would resolve against the server's own directory.
  const configDir = input.configDir || process.env.CLAUDE_CONFIG_DIR || homedir();
  const workspace = input.familiarWorkspace ? realpathSync.native(/* turbopackIgnore: true */ input.familiarWorkspace) : undefined;
  const config = await readJsonRecord(path.join(/* turbopackIgnore: true */ configDir, ".claude.json"));
  const perWorkspaceEntry = workspace && isRecord(config.projects) ? config.projects[workspace] : undefined;
  const perWorkspace = isRecord(perWorkspaceEntry) ? perWorkspaceEntry : {};
  const insideProject = workspace !== undefined && (input.projectRoots ?? []).some(
    root => isWithin(workspace, realpathSync.native(/* turbopackIgnore: true */ root)),
  );
  const shared = workspace && !insideProject ? await readJsonRecord(path.join(/* turbopackIgnore: true */ workspace, ".mcp.json")) : {};
  return {
    ...usableServers(config.mcpServers, perWorkspace.disabledMcpServers),
    ...usableServers(shared.mcpServers, perWorkspace.disabledMcpjsonServers),
    ...usableServers(perWorkspace.mcpServers, perWorkspace.disabledMcpServers),
  };
}

/** Its message is written for the person who can act on it. */
export class ClaudeAuthorityRootError extends Error {}

const nodeFileSystem = { lstat, mkdir, open, readdir, readFile, rm, rmdir, unlink };
type ClaudeAuthorityFileSystem = typeof nodeFileSystem;

const authorityRootPath = () => path.join(/* turbopackIgnore: true */ caveHome(), "claude-authority");

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function retireAbandonedAuthorityDirectories(authorityRoot: string, fileSystem: ClaudeAuthorityFileSystem) {
  const startedAt = Date.now() - process.uptime() * 1000;
  const entries = await fileSystem.readdir(/* turbopackIgnore: true */ authorityRoot).catch(() => [] as string[]);
  await Promise.all(entries.map(async (name) => {
    const owner = /^(\d+)-[0-9a-f-]{36}$/.exec(name)?.[1];
    if (!owner) return;
    const entry = path.join(/* turbopackIgnore: true */ authorityRoot, name);
    // A restarted container usually gets the same PID back, so a directory older
    // than this process can't be this process's own.
    const abandoned = Number(owner) === process.pid
      ? await fileSystem.lstat(/* turbopackIgnore: true */ entry).then(({ mtimeMs }) => mtimeMs < startedAt, () => false)
      : processIsGone(Number(owner));
    if (!abandoned) return;
    await fileSystem.rm(/* turbopackIgnore: true */ entry, { recursive: true, force: true }).catch(() => {
      console.warn("Could not remove an abandoned Claude authority directory.");
    });
  }));
}

/**
 * A killed server can't dispose its files, credentials included. Runs at startup
 * and before each turn's files are created, so they don't wait for the next
 * Full-access Claude turn.
 */
export function retireAbandonedClaudeAuthorityFiles() {
  return retireAbandonedAuthorityDirectories(authorityRootPath(), nodeFileSystem);
}

function canonicalDeepestExisting(target: string): string {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(/* turbopackIgnore: true */ realpathSync.native(/* turbopackIgnore: true */ current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Claude expands `${VAR}` and `${VAR:-default}` before it starts a server. */
function expandClaudeEnvironmentReferences(value: string): string {
  return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => process.env[name] ?? fallback ?? "");
}

function namesWritablePath(value: string, writableRoots: readonly string[]): boolean {
  return expandClaudeEnvironmentReferences(value).split(/[=:,;\s"']+/).some((part) => {
    const candidate = part.startsWith("~/") ? path.join(/* turbopackIgnore: true */ homedir(), part.slice(2)) : part;
    if (!path.isAbsolute(candidate)) return false;
    const canonical = canonicalDeepestExisting(candidate);
    return writableRoots.some(root => isWithin(canonical, root));
  });
}

const START_IN_DIRECTORY = 'cd "$1" && shift && exec "$@"';

/**
 * Local MCP processes run outside the sandbox, so nothing a familiar can rewrite
 * may decide what they execute. Claude starts them in the primary root and
 * ignores a `cwd` key, where `npx`, `python -m` and a project `.npmrc` would all
 * pick up files the familiar wrote, so they start from a folder no grant covers.
 * A server that names a path inside a writable root is left out, whatever the
 * path is for: a directory argument can be `uv --directory`, not just data.
 */
function confineMcpServers(servers: ClaudeMcpServers, writableRoots: readonly string[], neutralDirectory: string) {
  const confined: ClaudeMcpServers = {};
  const excluded: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const args = (server.args ?? []) as string[];
    const env = Object.values((server.env ?? {}) as Record<string, string>);
    const named = [server.command, server.headersHelper, ...args, ...env];
    if (named.some(value => typeof value === "string" && namesWritablePath(value, writableRoots))) {
      excluded.push(name);
      continue;
    }
    confined[name] = {
      ...server,
      ...(typeof server.command === "string"
        ? { command: "/bin/sh", args: ["-c", START_IN_DIRECTORY, "sh", neutralDirectory, server.command, ...args] }
        : {}),
      ...(typeof server.headersHelper === "string"
        ? { headersHelper: `cd '${neutralDirectory.replaceAll("'", "'\\''")}' && ${server.headersHelper}` }
        : {}),
    };
  }
  return { confined, excluded: excluded.sort() };
}

const sha256 = (contents: string | Uint8Array) => createHash("sha256").update(contents).digest("hex");

/**
 * The scope and MCP config decide what the next launch may write and what it
 * starts outside the sandbox, so no familiar may change them. They live under
 * Cave's home rather than temp: Claude's sandbox always allows
 * `/tmp/claude-<uid>`, where `tmpdir()` points for a server started from a
 * sandboxed session, and the supported Claude version is a floor, not a pin.
 * Refusing a writable grant over or inside this root keeps every turn's files
 * out of every sandbox. Each launch also denies its own directory outright, which lets
 * Claude's Read tool open it; that is no wider than sandboxed Bash reads already are.
 *
 * Allocate only after stream admission. The MCP config can hold server
 * credentials, so it never travels through argv.
 */
export function prepareClaudeWriteScopeFile(
  baseScope: ClaudeWriteScope,
  mcpServers: ClaudeMcpServers = {},
  options: { fileSystem?: ClaudeAuthorityFileSystem } = {},
) {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const requestedRoot = authorityRootPath();
  let authorityRoot: string;
  try {
    mkdirSync(/* turbopackIgnore: true */ requestedRoot, { recursive: true, mode: 0o700 });
    authorityRoot = realpathSync.native(/* turbopackIgnore: true */ requestedRoot);
  } catch {
    throw new ClaudeAuthorityRootError("Cave couldn't open its private state folder. Check the disk's free space and that folder's permissions, then retry.");
  }
  if (baseScope.writableRoots.some(root => isWithin(authorityRoot, root) || isWithin(root, authorityRoot))) {
    throw new ClaudeAuthorityRootError("A folder this familiar can write to overlaps Cave's private state folder. Narrow that access or use Read-only, then retry.");
  }
  const directory = path.join(/* turbopackIgnore: true */ authorityRoot, `${process.pid}-${randomUUID()}`);
  const filePath = path.join(/* turbopackIgnore: true */ directory, "scope.json");
  const { confined, excluded } = confineMcpServers(mcpServers, baseScope.writableRoots, authorityRoot);
  const mcpNames = Object.keys(confined).sort();
  const mcpPath = mcpNames.length ? path.join(/* turbopackIgnore: true */ directory, "mcp.json") : undefined;
  const scope: ClaudeWriteScope = {
    ...baseScope,
    protectedRoots: [...baseScope.protectedRoots, directory].sort(),
    ...(mcpPath ? { mcpConfigFile: mcpPath, mcpServerNames: mcpNames } : {}),
  };
  // The MCP config can hold credentials, so its contents last only until creation.
  const unwritten = new Map<string, string>();
  if (mcpPath) unwritten.set(mcpPath, JSON.stringify({ mcpServers: confined }));
  unwritten.set(filePath, JSON.stringify(scope));
  const digests = new Map([...unwritten].map(([target, contents]) => [target, sha256(contents)]));
  // Tracked from the moment a file exists. Null means its identity isn't known
  // yet, as after a partial write or a failed stat.
  const allocated = new Map<string, { dev: number; ino: number } | null>();
  let directoryAllocated = false;

  const hasIdentity = async (target: string, identity: { dev: number; ino: number }) => {
    const metadata = await fileSystem.lstat(/* turbopackIgnore: true */ target);
    return metadata.isFile() && metadata.dev === identity.dev && metadata.ino === identity.ino;
  };
  // Each file retires on its own, so a changed scope can't strand the credentials.
  const retire = async () => {
    let retained = false;
    for (const [target, identity] of allocated) {
      try {
        if (identity && !(await hasIdentity(target, identity))) {
          retained = true;
          continue;
        }
        await fileSystem.unlink(/* turbopackIgnore: true */ target);
        allocated.delete(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") allocated.delete(target);
        else retained = true;
      }
    }
    if (retained) throw new Error("An authority file changed or could not be removed; retained for inspection.");
    if (directoryAllocated) {
      await fileSystem.rmdir(/* turbopackIgnore: true */ directory);
      directoryAllocated = false;
    }
  };

  return {
    path: filePath,
    excludedMcpServers: excluded,
    async create() {
      await retireAbandonedAuthorityDirectories(authorityRoot, fileSystem);
      await fileSystem.mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700 });
      directoryAllocated = true;
      try {
        for (const [target, contents] of unwritten) {
          const handle = await fileSystem.open(/* turbopackIgnore: true */ target, "wx", 0o600);
          allocated.set(target, null);
          try {
            await handle.writeFile(contents);
            const metadata = await handle.stat();
            allocated.set(target, { dev: metadata.dev, ino: metadata.ino });
          } finally {
            await handle.close();
          }
        }
      } catch (error) {
        // `dispose` retries anything this can't remove.
        await retire().catch(() => {});
        throw error;
      } finally {
        unwritten.clear();
      }
    },
    /**
     * Run before every launch, including a retry inside one turn. The sandbox
     * keeps familiars out; this catches a change made between launches. A writer
     * outside the sandbox could still race it, but already has the owner's authority.
     */
    async assertIntact() {
      for (const [target, digest] of digests) {
        const identity = allocated.get(target);
        if (!identity || !(await hasIdentity(target, identity))
          || sha256(await fileSystem.readFile(/* turbopackIgnore: true */ target)) !== digest) {
          throw new Error("An authority file changed after it was written.");
        }
      }
    },
    dispose: retire,
  };
}

/** Preserve no provider paths, tool inputs, or raw diagnostics in the notice. */
export function countClaudeWriteDenials(frame: unknown): number {
  if (!frame || typeof frame !== "object") return 0;
  const denials = (frame as { permission_denials?: unknown }).permission_denials;
  if (!Array.isArray(denials)) return 0;
  const writeTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"]);
  return denials.slice(0, 1000).filter(value => value && typeof value === "object"
    && typeof value.tool_name === "string" && writeTools.has(value.tool_name)).length;
}

/** Classify only known Rust policy refusals; never reflect its raw detail. */
export function claudeWriteScopeRefusal(error: unknown): { code: string; message: string } | null {
  if (typeof error !== "string") return null;
  if (error.includes("writeScope cannot use inherited Claude permission or settings overrides")) {
    return { code: "write_scope_environment_unsupported", message: "Claude's inherited settings conflict with scoped project access. Restart Coven without runtime permission or settings overrides, then retry." };
  }
  if (error.includes("writeScope has filesystem-object aliases")) {
    return { code: "write_scope_aliases_unsupported", message: "Some files in this writable folder are also linked outside it. Use an isolated copy of the folder or narrow its write access, then retry." };
  }
  if (error.includes("unsupported native rule syntax")) {
    return { code: "write_scope_path_unsupported", message: "A folder this familiar can access has a name Claude's sandbox can't use. Rename it or remove its access so no folder name contains * ? [ ] { } ! ( or ), then retry." };
  }
  if (/Claude scoped.write (?:profile|qualification)|Claude scoped writes (?:are not qualified|require a qualified)/.test(error)) {
    return { code: "write_scope_profile_unqualified", message: "This Claude runtime has not been qualified for project write access. Use a qualified runtime or update Coven's runtime support, then retry." };
  }
  if (/writeScope|Claude scoped.write/.test(error)) {
    return { code: "runtime_write_scope_unavailable", message: "Coven could not apply this familiar's write access. Review project access and the runtime version, then retry." };
  }
  return null;
}
