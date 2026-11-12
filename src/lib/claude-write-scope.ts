import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rm, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { cavePrivateStatePath, overlapsCavePrivateState } from "./cave-private-state.ts";
import { shellQuote } from "./familiar-runtime.ts";
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

/**
 * Whether this absolute path, or any folder on the way to it, is inside a
 * writable root. A link inside a writable root can be re-pointed, so where it
 * points today doesn't settle it. A folder that doesn't exist can't hold a
 * link, so the walk stops there.
 */
function reachesWritableRoot(candidate: string, writableRoots: readonly string[]): boolean {
  let prefix = "";
  for (const segment of candidate.split("/")) {
    if (!segment) continue;
    prefix += `/${segment}`;
    let canonical: string;
    try {
      canonical = realpathSync.native(/* turbopackIgnore: true */ prefix);
    } catch {
      return false;
    }
    if (writableRoots.some(root => isWithin(canonical, root))) return true;
  }
  return false;
}

async function readJsonRecord(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read ${path.basename(file)}, so this turn's MCP setup leaves it out.`);
    }
    return {};
  }
}

/**
 * Claude's sandbox protects `.claude.json` and `.mcp.json` by name. Through a
 * link, a file in a writable root could stand in for one under another name.
 */
async function readOwnerConfig(file: string, writableRoots: readonly string[]): Promise<Record<string, unknown>> {
  let target: string;
  try {
    target = realpathSync.native(/* turbopackIgnore: true */ file);
  } catch {
    return readJsonRecord(file);
  }
  const direct = path.join(/* turbopackIgnore: true */ realpathSync.native(/* turbopackIgnore: true */ path.dirname(file)), path.basename(file));
  if (target !== direct && writableRoots.some(root => isWithin(target, root))) {
    console.warn(`${path.basename(file)} links into a folder this familiar can write to, so its MCP servers are left out of this turn.`);
    return {};
  }
  return readJsonRecord(file);
}

const isStringList = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string");
const nameList = (value: unknown): string[] => Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];

function isUsableServer(server: unknown): server is ClaudeMcpServer {
  if (!isRecord(server)) return false;
  if (typeof server.command === "string") {
    return (server.args === undefined || isStringList(server.args))
      && (server.env === undefined || (isRecord(server.env) && isStringList(Object.values(server.env))));
  }
  return typeof server.url === "string" && (server.headersHelper === undefined || typeof server.headersHelper === "string");
}

function usableServers(servers: unknown, disabled: readonly string[]): ClaudeMcpServers {
  if (!isRecord(servers)) return {};
  const disabledNames = new Set(disabled);
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

/** A `.git` above the workspace makes the workspace a folder in that repository. */
function insideRepository(directory: string): boolean {
  for (let parent = path.dirname(directory); parent !== path.dirname(parent); parent = path.dirname(parent)) {
    if (existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ parent, ".git"))) return true;
  }
  return false;
}

/**
 * Owner-configured MCP servers for one familiar, from Claude's user and
 * per-workspace entries and the familiar workspace's `.mcp.json`, in Claude's
 * own order: a per-workspace entry beats the workspace file, which beats user
 * scope. Claude's sandbox refuses writes to `.mcp.json` and `.claude.json`, so a
 * familiar can't add its own server. A repository's `.mcp.json` is never read,
 * including at a workspace inside a granted project or under a `.git`:
 * repository content must not be able to start a process outside the sandbox.
 * This launch runs under another project's key in Claude's config, so every
 * disable list the owner set for this workspace is applied here or not at all.
 */
export async function loadClaudeFamiliarMcpServers(input: {
  familiarWorkspace?: string;
  projectRoots?: readonly string[];
  writableRoots?: readonly string[];
  configDir?: string;
}): Promise<ClaudeMcpServers> {
  // Not `??`: an empty value would resolve against the server's own directory.
  const configDir = input.configDir || process.env.CLAUDE_CONFIG_DIR;
  const writableRoots = input.writableRoots ?? [];
  const workspace = input.familiarWorkspace ? realpathSync.native(/* turbopackIgnore: true */ input.familiarWorkspace) : undefined;
  const config = await readOwnerConfig(path.join(/* turbopackIgnore: true */ configDir || homedir(), ".claude.json"), writableRoots);
  const projects = isRecord(config.projects) ? config.projects : {};
  const perWorkspaceEntry = workspace ? projects[workspace] ?? projects[input.familiarWorkspace!] : undefined;
  const perWorkspace = isRecord(perWorkspaceEntry) ? perWorkspaceEntry : {};
  const repositoryContent = workspace !== undefined && (insideRepository(workspace) || (input.projectRoots ?? []).some(
    root => isWithin(workspace, realpathSync.native(/* turbopackIgnore: true */ root)),
  ));
  const shared = workspace && !repositoryContent
    ? await readOwnerConfig(path.join(/* turbopackIgnore: true */ workspace, ".mcp.json"), writableRoots) : {};
  const settings = await Promise.all([
    path.join(/* turbopackIgnore: true */ configDir || path.join(/* turbopackIgnore: true */ homedir(), ".claude"), "settings.json"),
    ...(workspace ? ["settings.json", "settings.local.json"].map(name => path.join(/* turbopackIgnore: true */ workspace, ".claude", name)) : []),
  ].map(readJsonRecord));
  const disabled = nameList(perWorkspace.disabledMcpServers);
  const disabledShared = [
    ...disabled, ...nameList(perWorkspace.disabledMcpjsonServers),
    ...settings.flatMap(entry => nameList(entry.disabledMcpjsonServers)),
  ];
  return {
    ...usableServers(config.mcpServers, disabled),
    ...usableServers(shared.mcpServers, disabledShared),
    ...usableServers(perWorkspace.mcpServers, disabled),
  };
}

/** Its message is written for the person who can act on it. */
export class ClaudeAuthorityRootError extends Error {}

const nodeFileSystem = { lstat, mkdir, open, readdir, readFile, rm, rmdir, unlink };
type ClaudeAuthorityFileSystem = typeof nodeFileSystem;

const authorityRootPath = cavePrivateStatePath;

/** Shared across bundles and reloads, so every copy of this module sees one process's turns. */
const OWNED_DIRECTORIES = Symbol.for("opencoven.cave.claudeAuthorityDirectories");
function ownedDirectories(): Set<string> {
  const state = globalThis as typeof globalThis & { [OWNED_DIRECTORIES]?: Set<string> };
  return (state[OWNED_DIRECTORIES] ??= new Set());
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function retireAbandonedAuthorityDirectories(authorityRoot: string, fileSystem: ClaudeAuthorityFileSystem) {
  const entries = await fileSystem.readdir(/* turbopackIgnore: true */ authorityRoot).catch(() => [] as string[]);
  await Promise.all(entries.map(async (name) => {
    const owner = /^(\d+)-[0-9a-f-]{36}$/.exec(name)?.[1];
    if (!owner) return;
    // A restarted container usually gets the same PID back, so a directory with
    // this process's number that this process didn't create is a predecessor's.
    const abandoned = Number(owner) === process.pid ? !ownedDirectories().has(name) : processIsGone(Number(owner));
    if (!abandoned) return;
    await fileSystem.rm(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ authorityRoot, name), { recursive: true, force: true }).catch(() => {
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

/** `${VAR}` and `${VAR:-default}` as Claude expands them, which keeps an unset `${VAR}` as written, and `$VAR` as a shell does. */
function expandReferences(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(
    /\$\{([^}:]+)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced: string | undefined, fallback: string | undefined, bare: string | undefined) =>
      env[braced ?? bare ?? ""] ?? fallback ?? (braced ? match : ""),
  );
}

const PATH_BREAK = String.raw`=:,;\s"'<>|&()[\]`;

/**
 * Whether a config value spells a path inside a writable root. This only
 * decides the notice: the OS rule in confineMcpServers holds however a path is
 * written. A path starts at any token, but runs to the end of the value, since
 * a root's own name can hold spaces and separators.
 */
function namesWritablePath(value: string, writableRoots: readonly string[], primaryRoot: string, env: NodeJS.ProcessEnv): boolean {
  const home = env.HOME || homedir();
  const text = expandReferences(value, env)
    .replace(/\\(.)/g, "$1")
    .replace(new RegExp(`(^|[${PATH_BREAK}])~(?=/)`, "g"), (_, before: string) => before + home);
  for (const token of text.matchAll(new RegExp(`[^${PATH_BREAK}]+`, "g"))) {
    const slash = token[0].indexOf("/");
    if (slash < 0) continue;
    if (reachesWritableRoot(text.slice(token.index + slash), writableRoots)) return true;
    // Claude used to start servers in the primary root, where a relative path resolved.
    const relative = path.resolve(/* turbopackIgnore: true */ primaryRoot, token[0]);
    if (slash > 0 && existsSync(/* turbopackIgnore: true */ relative) && reachesWritableRoot(relative, writableRoots)) return true;
  }
  return false;
}

/** The only temp folder Claude's sandbox lets a familiar write. */
const claudeSandboxTemp = () => `/private/tmp/claude-${process.getuid?.() ?? 0}`;

/** Seatbelt arguments that keep a process, and all it starts, out of these folders. */
function sandboxArguments(deniedRoots: readonly string[]): string[] {
  const rules = deniedRoots.map((_, index) => `(subpath (param "ROOT${index}"))`).join(" ");
  return [
    "/usr/bin/sandbox-exec",
    ...deniedRoots.flatMap((root, index) => ["-D", `ROOT${index}=${root}`]),
    "-p", `(version 1)(allow default)(deny file-read* file-write* process-exec ${rules})`,
  ];
}

const START_IN_DIRECTORY = 'cd "$1" && shift && exec "$@"';

/**
 * Local MCP processes run outside Claude's sandbox, so a familiar must not be
 * able to decide what they run. Each starts from a folder no grant covers,
 * under an OS rule that keeps it and everything it starts from reading,
 * writing or running anything in a writable root or Claude's sandbox temp: a
 * planted package, script, link or PATH entry can't load however it's reached.
 * Coven only runs scoped writes on macOS, where `sandbox-exec` is part of the
 * OS. A tool that starts its own sandbox, such as Chromium without
 * `--no-sandbox`, can't start inside this one.
 *
 * A server whose config names a writable path would only fail at startup, so it
 * is left out with a notice. PATH loses its writable entries, so a tool found
 * later on it still runs.
 */
function confineMcpServers(
  servers: ClaudeMcpServers,
  scope: Pick<ClaudeWriteScope, "writableRoots" | "primaryRoot">,
  neutralDirectory: string,
  env: NodeJS.ProcessEnv,
) {
  const { writableRoots, primaryRoot } = scope;
  const sandbox = sandboxArguments([...writableRoots, claudeSandboxTemp()]);
  const pathEntries = env.PATH?.split(":") ?? [];
  const safeEntries = pathEntries.filter(entry => !path.isAbsolute(entry) || !reachesWritableRoot(entry, writableRoots));
  const safePath = safeEntries.length === pathEntries.length ? undefined : safeEntries.join(":");
  const confined: ClaudeMcpServers = {};
  const excluded: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const args = (server.args ?? []) as string[];
    const serverEnv = (server.env ?? {}) as Record<string, string>;
    const lookup = { ...env, ...serverEnv };
    const named = [server.command, server.headersHelper, ...args, ...Object.values(serverEnv)];
    if (named.some(value => typeof value === "string" && namesWritablePath(value, writableRoots, primaryRoot, lookup))) {
      excluded.push(name);
      continue;
    }
    confined[name] = {
      ...server,
      ...(typeof server.command === "string" ? {
        command: "/bin/sh",
        args: ["-c", START_IN_DIRECTORY, "sh", neutralDirectory, ...sandbox, server.command, ...args],
        ...(safePath !== undefined && serverEnv.PATH === undefined ? { env: { ...serverEnv, PATH: safePath } } : {}),
      } : {}),
      ...(typeof server.headersHelper === "string" ? {
        headersHelper: [
          `cd ${shellQuote(neutralDirectory)}`,
          ...(safePath !== undefined ? [`export PATH=${shellQuote(safePath)}`] : []),
          `exec ${[...sandbox, "/bin/sh", "-c", server.headersHelper].map(shellQuote).join(" ")}`,
        ].join(" && "),
      } : {}),
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
 * credentials, so it never travels through argv. Pass the launch's own
 * environment: Claude expands `${VAR}` from it, and PATH there finds commands.
 */
export function prepareClaudeWriteScopeFile(
  baseScope: ClaudeWriteScope,
  mcpServers: ClaudeMcpServers = {},
  options: { fileSystem?: ClaudeAuthorityFileSystem; env?: NodeJS.ProcessEnv } = {},
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
  if (baseScope.writableRoots.some(root => overlapsCavePrivateState(root, authorityRoot))) {
    throw new ClaudeAuthorityRootError("A folder this familiar can write to overlaps Cave's private state folder. Narrow that access or use Read-only, then retry.");
  }
  const directoryName = `${process.pid}-${randomUUID()}`;
  const directory = path.join(/* turbopackIgnore: true */ authorityRoot, directoryName);
  const filePath = path.join(/* turbopackIgnore: true */ directory, "scope.json");
  // Empty and shared, apart from the per-turn directories that hold credentials.
  const mcpWorkingDirectory = path.join(/* turbopackIgnore: true */ authorityRoot, "mcp-cwd");
  const { confined, excluded } = confineMcpServers(mcpServers, baseScope, mcpWorkingDirectory, options.env ?? process.env);
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
    ownedDirectories().delete(directoryName);
  };

  return {
    path: filePath,
    excludedMcpServers: excluded,
    async create() {
      // Claimed before it exists, so a concurrent sweep never takes it for a predecessor's.
      ownedDirectories().add(directoryName);
      try {
        await retireAbandonedAuthorityDirectories(authorityRoot, fileSystem);
        if (mcpPath) await fileSystem.mkdir(/* turbopackIgnore: true */ mcpWorkingDirectory, { recursive: true, mode: 0o700 });
        await fileSystem.mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700 });
        directoryAllocated = true;
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
