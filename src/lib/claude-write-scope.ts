import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, open, lstat, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProjectAccessLevel } from "./project-access-levels.ts";

export type ClaudeWriteScope = {
  version: 1;
  primaryRoot: string;
  writableRoots: string[];
  readOnlyRoots: string[];
  protectedRoots: string[];
};

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
  const canonical = (root: string) => realpathSync.native(root);
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
    version: 1, primaryRoot,
    writableRoots: [...writable].sort(),
    readOnlyRoots: [...readable].filter(root => !writable.has(root)).sort(),
    protectedRoots: [...new Set(input.protectedRoots.map(canonical))].sort(),
  };
}

/** Allocate only after stream admission; keep this file out of project roots. */
export function prepareClaudeWriteScopeFile(scope: ClaudeWriteScope) {
  const directory = path.join(tmpdir(), `cave-claude-write-scope-${randomUUID()}`);
  const filePath = path.join(directory, "scope.json");
  let identity: { dev: number; ino: number } | undefined;
  return {
    path: filePath,
    async create() {
      await mkdir(directory, { mode: 0o700 });
      const file = await open(filePath, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(scope));
        const metadata = await file.stat();
        identity = { dev: metadata.dev, ino: metadata.ino };
      } finally { await file.close(); }
    },
    async dispose() {
      if (!identity) return;
      const metadata = await lstat(filePath);
      if (!metadata.isFile() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) {
        throw new Error("Scope file identity changed; retained for inspection.");
      }
      await unlink(filePath);
      await rmdir(directory);
      identity = undefined;
    },
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
