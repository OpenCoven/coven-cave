import { randomUUID } from "node:crypto";
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

export type ClaudeMcpServers = Record<string, unknown>;

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

async function readMcpServers(file: string, select: (parsed: Record<string, unknown>) => unknown): Promise<ClaudeMcpServers> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
    const servers = select(parsed && typeof parsed === "object" ? parsed : {});
    return servers && typeof servers === "object" && !Array.isArray(servers) ? servers as ClaudeMcpServers : {};
  } catch {
    return {};
  }
}

/**
 * Owner-configured MCP servers for one familiar: Claude's user and per-workspace
 * entries, then the familiar workspace's `.mcp.json`. MCP servers run outside
 * the shell sandbox, so a project repository's own `.mcp.json` is never read:
 * repository content must not be able to start an unsandboxed process. Claude's
 * sandbox refuses writes to `.mcp.json`, so a familiar cannot add its own server.
 */
export async function loadClaudeFamiliarMcpServers(input: {
  familiarWorkspace?: string;
  configDir?: string;
}): Promise<ClaudeMcpServers> {
  const configDir = input.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? homedir();
  const workspace = input.familiarWorkspace;
  const canonicalWorkspace = workspace ? realpathSync.native(/* turbopackIgnore: true */ workspace) : undefined;
  const servers = {
    ...await readMcpServers(path.join(/* turbopackIgnore: true */ configDir, ".claude.json"), (parsed) => {
      const projects = (parsed.projects ?? {}) as Record<string, { mcpServers?: unknown }>;
      const local = canonicalWorkspace ? projects[canonicalWorkspace]?.mcpServers ?? (workspace ? projects[workspace]?.mcpServers : undefined) : undefined;
      return { ...(parsed.mcpServers as object | undefined), ...(local as object | undefined) };
    }),
    ...(canonicalWorkspace ? await readMcpServers(path.join(/* turbopackIgnore: true */ canonicalWorkspace, ".mcp.json"), (parsed) => parsed.mcpServers) : {}),
  };
  return Object.fromEntries(Object.entries(servers).filter(([name]) => /^[A-Za-z0-9_-]+$/.test(name)));
}

/** A writable grant over this root would put every turn's authority files within a familiar's reach. */
export class ClaudeAuthorityRootGrantedError extends Error {
  constructor() {
    super("A writable project grant includes Cave's private state folder. Narrow that grant or use Read-only, then retry.");
  }
}

const nodeFileSystem = { lstat, mkdir, open, readdir, readFile, rm, rmdir, unlink };
export type ClaudeAuthorityFileSystem = typeof nodeFileSystem;

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(/* turbopackIgnore: true */ root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** A killed server can't dispose its files, so the next turn retires them, credentials included. */
async function retireAbandonedAuthorityDirectories(authorityRoot: string, fileSystem: ClaudeAuthorityFileSystem) {
  const entries = await fileSystem.readdir(/* turbopackIgnore: true */ authorityRoot).catch(() => [] as string[]);
  await Promise.all(entries.map(async (name) => {
    const owner = /^(\d+)-[0-9a-f-]{36}$/.exec(name)?.[1];
    if (!owner || !processIsGone(Number(owner))) return;
    await fileSystem.rm(path.join(/* turbopackIgnore: true */ authorityRoot, name), { recursive: true, force: true }).catch(() => {});
  }));
}

/**
 * The scope and MCP config decide what the next launch may write and what it
 * starts outside the sandbox, so no familiar may change them. They live under
 * Cave's home rather than temp: Claude's sandbox always allows
 * `/tmp/claude-<uid>`, where `tmpdir()` points for a server started from a
 * sandboxed session, and the supported Claude version is a floor, not a pin.
 * Refusing a writable grant over this root keeps every turn's files out of every
 * sandbox. Each launch also denies its own directory outright, which lets
 * Claude's Read tool open it; that is no wider than sandboxed Bash reads already are.
 *
 * Allocate only after stream admission. The MCP config can hold server
 * credentials, so it never travels through argv.
 */
export function prepareClaudeWriteScopeFile(
  baseScope: ClaudeWriteScope,
  mcpServers: ClaudeMcpServers = {},
  options: { authorityRoot?: string; fileSystem?: ClaudeAuthorityFileSystem } = {},
) {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const requestedRoot = options.authorityRoot ?? path.join(/* turbopackIgnore: true */ caveHome(), "claude-authority");
  mkdirSync(/* turbopackIgnore: true */ requestedRoot, { recursive: true, mode: 0o700 });
  const authorityRoot = realpathSync.native(/* turbopackIgnore: true */ requestedRoot);
  if (baseScope.writableRoots.some(root => isWithin(authorityRoot, root))) throw new ClaudeAuthorityRootGrantedError();
  const directory = path.join(/* turbopackIgnore: true */ authorityRoot, `${process.pid}-${randomUUID()}`);
  const filePath = path.join(/* turbopackIgnore: true */ directory, "scope.json");
  const mcpNames = Object.keys(mcpServers).sort();
  const mcpPath = mcpNames.length ? path.join(/* turbopackIgnore: true */ directory, "mcp.json") : undefined;
  const scope: ClaudeWriteScope = {
    ...baseScope,
    protectedRoots: [...baseScope.protectedRoots, directory].sort(),
    ...(mcpPath ? { mcpConfigFile: mcpPath, mcpServerNames: mcpNames } : {}),
  };
  const expected = new Map<string, string>();
  if (mcpPath) expected.set(mcpPath, JSON.stringify({ mcpServers }));
  expected.set(filePath, JSON.stringify(scope));
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
    async create() {
      await retireAbandonedAuthorityDirectories(authorityRoot, fileSystem);
      await fileSystem.mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700 });
      directoryAllocated = true;
      try {
        for (const [target, contents] of expected) {
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
      }
    },
    /**
     * Run before every launch, including a retry inside one turn. The sandbox
     * keeps familiars out; this catches any other writer, such as an MCP server.
     */
    async assertIntact() {
      for (const [target, contents] of expected) {
        const identity = allocated.get(target);
        if (!identity || !(await hasIdentity(target, identity))
          || await fileSystem.readFile(/* turbopackIgnore: true */ target, "utf8") !== contents) {
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
  if (/Claude scoped.write (?:profile|qualification)|Claude scoped writes (?:are not qualified|require a qualified)/.test(error)) {
    return { code: "write_scope_profile_unqualified", message: "This Claude runtime has not been qualified for project write access. Use a qualified runtime or update Coven's runtime support, then retry." };
  }
  if (/writeScope|Claude scoped.write/.test(error)) {
    return { code: "runtime_write_scope_unavailable", message: "Coven could not apply this familiar's write access. Review project access and the runtime version, then retry." };
  }
  return null;
}
