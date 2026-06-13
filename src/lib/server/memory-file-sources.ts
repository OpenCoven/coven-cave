import path from "node:path";
import { homedir } from "node:os";

export type MemorySourceKind = "coven-origin" | "external-harness" | "runtime";

export type MemoryFileSource = {
  id: string;
  kind: MemorySourceKind;
  label: string;
  rootPath: string;
  root: string;
  rootLabel: string;
  origin?: "coven";
  harnessId?: string;
  runtimeId?: string;
};

export type MemoryFileClassification = {
  sourceId: string;
  sourceKind: MemorySourceKind;
  sourceKindLabel: string;
  kind: MemorySourceKind;
  root: string;
  rootLabel: string;
  rootPath: string;
  origin?: "coven";
  harnessId?: string;
  runtimeId?: string;
  familiarId?: string;
};

function isWithinRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

function displayId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || id;
}

function sourceKindLabel(kind: MemorySourceKind): string {
  if (kind === "coven-origin") return "Coven origin";
  if (kind === "external-harness") return "External harness";
  return "Runtime";
}

export function memoryFileSourcesForHome(home = homedir()): MemoryFileSource[] {
  const openclawWorkspace = path.join(home, ".openclaw", "workspace");
  return [
    {
      id: "coven-origin",
      kind: "coven-origin",
      label: "Coven native memory",
      rootPath: path.join(home, ".coven", "memory"),
      root: "coven-origin",
      rootLabel: "Coven native memory",
      origin: "coven",
    },
    {
      id: "openclaw-workspace",
      kind: "external-harness",
      label: "OpenClaw harness memory",
      rootPath: path.join(openclawWorkspace, "memory"),
      root: "workspace",
      rootLabel: "OpenClaw harness memory",
      harnessId: "openclaw",
    },
    {
      id: "openclaw-index",
      kind: "external-harness",
      label: "OpenClaw workspace index",
      rootPath: path.join(openclawWorkspace, "MEMORY.md"),
      root: "index",
      rootLabel: "OpenClaw workspace index",
      harnessId: "openclaw",
    },
    {
      id: "codex-runtime",
      kind: "runtime",
      label: "Codex runtime memory",
      rootPath: path.join(home, ".codex", "memories"),
      root: "codex-runtime",
      rootLabel: "Codex runtime memory",
      runtimeId: "codex",
    },
  ];
}

export function classifyMemoryFilePath(fullPath: string, home = homedir()): MemoryFileClassification | null {
  const resolved = path.resolve(/* turbopackIgnore: true */ fullPath);
  for (const source of memoryFileSourcesForHome(home)) {
    const rootPath = path.resolve(/* turbopackIgnore: true */ source.rootPath);
    if (!isWithinRoot(resolved, rootPath)) continue;
    return {
      sourceId: source.id,
      sourceKind: source.kind,
      sourceKindLabel: sourceKindLabel(source.kind),
      kind: source.kind,
      root: source.root,
      rootLabel: source.rootLabel,
      rootPath,
      ...(source.origin ? { origin: source.origin } : {}),
      ...(source.harnessId ? { harnessId: source.harnessId } : {}),
      ...(source.runtimeId ? { runtimeId: source.runtimeId } : {}),
    };
  }

  const openclawWorkspace = path.resolve(
    /* turbopackIgnore: true */ path.join(home, ".openclaw", "workspace"),
  );
  if (isWithinRoot(resolved, openclawWorkspace)) {
    const rel = path.relative(openclawWorkspace, resolved);
    const parts = rel.split(path.sep);
    const familiarId = parts[0];
    if (familiarId && familiarId !== ".." && familiarId !== "memory" && familiarId !== "MEMORY.md") {
      const isFamiliarIndex = parts.length === 2 && parts[1] === "MEMORY.md";
      const isFamiliarMemory = parts.length >= 3 && parts[1] === "memory";
      if (isFamiliarIndex || isFamiliarMemory) {
        return {
          sourceId: "openclaw-familiar",
          sourceKind: "external-harness",
          sourceKindLabel: "External harness",
          kind: "external-harness",
          root: `familiar:${familiarId}`,
          rootLabel: `${displayId(familiarId)} harness memory`,
          rootPath: path.join(openclawWorkspace, familiarId),
          harnessId: "openclaw",
          familiarId,
        };
      }
    }
  }

  const covenFamiliars = path.resolve(
    /* turbopackIgnore: true */ path.join(home, ".coven", "workspaces", "familiars"),
  );
  if (isWithinRoot(resolved, covenFamiliars)) {
    const rel = path.relative(covenFamiliars, resolved);
    const parts = rel.split(path.sep);
    const familiarId = parts[0];
    if (familiarId && familiarId !== ".." && parts[1] === "memory" && parts.length >= 3) {
      return {
        sourceId: "coven-familiar",
        sourceKind: "coven-origin",
        sourceKindLabel: "Coven origin",
        kind: "coven-origin",
        root: `coven-familiar:${familiarId}`,
        rootLabel: `${displayId(familiarId)} memory`,
        rootPath: path.join(covenFamiliars, familiarId),
        origin: "coven",
        familiarId,
      };
    }
  }

  return null;
}

export function isMemoryFilePathAllowed(fullPath: string, home = homedir()): boolean {
  return classifyMemoryFilePath(fullPath, home) !== null;
}
