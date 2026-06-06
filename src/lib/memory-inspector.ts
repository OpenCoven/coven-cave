import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export type FailureDistillation = {
  id: string;
  type: string;
  title: string;
  date: string;
  severity: string;
  domain: string;
  status: string;
  path: string;
  body: string;
  sections: Record<string, string>;
  wikilinks: string[];
};

export type MemoryTierHealth = {
  path: string;
  exists: boolean;
  modified: string | null;
  size: number | null;
  writeAuthority: "workspace" | "familiar";
};

export type DreamArtifactSummary = {
  path: string;
  exists: boolean;
  modified: string | null;
  updatedAt: string | null;
  entryCount: number;
  topLevelKeys: string[];
};

export type MemoryInspectorReport = {
  ok: true;
  familiarId: string;
  workspacePath: string;
  failures: FailureDistillation[];
  memoryTier: MemoryTierHealth;
  dreams: {
    active: boolean;
    phaseSignals: DreamArtifactSummary | null;
    shortTermRecall: DreamArtifactSummary | null;
  };
};

export const DEFAULT_WORKSPACE_ROOT = path.join(homedir(), ".openclaw", "workspace");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const REQUIRED_FRONTMATTER = ["id", "type", "title", "date", "severity", "domain", "status"] as const;

export function workspacePathForFamiliar(workspaceRoot: string, familiarId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(familiarId)) {
    throw new Error("invalid familiar id");
  }
  return familiarId === "main" ? workspaceRoot : path.join(workspaceRoot, familiarId);
}

export function parseFailureDistillation(text: string, filePath: string): FailureDistillation {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`failure entry missing frontmatter: ${filePath}`);
  }
  const frontmatter = parseFrontmatter(match[1]);
  const missing = REQUIRED_FRONTMATTER.filter((key) => !frontmatter[key]);
  if (missing.length > 0) {
    throw new Error(`failure entry missing ${missing.join(", ")}: ${filePath}`);
  }
  const body = text.slice(match[0].length).trim();
  return {
    id: frontmatter.id,
    type: frontmatter.type,
    title: frontmatter.title,
    date: frontmatter.date,
    severity: frontmatter.severity,
    domain: frontmatter.domain,
    status: frontmatter.status,
    path: filePath,
    body,
    sections: parseSections(body),
    wikilinks: parseWikilinks(body),
  };
}

export async function collectMemoryInspector({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  familiarId,
}: {
  workspaceRoot?: string;
  familiarId: string;
}): Promise<MemoryInspectorReport> {
  const workspacePath = workspacePathForFamiliar(workspaceRoot, familiarId);
  const [failures, memoryTier, phaseSignals, shortTermRecall] = await Promise.all([
    collectFailures(path.join(workspacePath, "memory", "failures")),
    collectMemoryTier(path.join(workspacePath, "MEMORY.md"), familiarId),
    collectDreamArtifact(path.join(workspacePath, "memory", ".dreams", "phase-signals.json")),
    collectDreamArtifact(path.join(workspacePath, "memory", ".dreams", "short-term-recall.json")),
  ]);

  return {
    ok: true,
    familiarId,
    workspacePath,
    failures,
    memoryTier,
    dreams: {
      active: !!phaseSignals.exists || !!shortTermRecall.exists,
      phaseSignals,
      shortTermRecall,
    },
  };
}

function parseFrontmatter(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    values[match[1]] = raw.replace(/^["']|["']$/g, "");
  }
  return values;
}

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let lines: string[] = [];

  const flush = () => {
    if (!current) return;
    sections[current] = lines.join("\n").trim();
  };

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      lines = [];
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return sections;
}

function parseWikilinks(body: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    links.add(match[1].trim());
  }
  return [...links];
}

async function collectFailures(failuresDir: string): Promise<FailureDistillation[]> {
  let names: string[];
  try {
    names = await readdir(failuresDir);
  } catch {
    return [];
  }

  const entries: FailureDistillation[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const fullPath = path.join(failuresDir, name);
    try {
      const text = await readFile(fullPath, "utf8");
      entries.push(parseFailureDistillation(text, fullPath));
    } catch {
      /* Skip malformed entries; the inspector is read-only and should stay calm. */
    }
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  return entries;
}

async function collectMemoryTier(memoryPath: string, familiarId: string): Promise<MemoryTierHealth> {
  try {
    const s = await stat(memoryPath);
    return {
      path: memoryPath,
      exists: true,
      modified: s.mtime.toISOString(),
      size: s.size,
      writeAuthority: familiarId === "main" ? "workspace" : "familiar",
    };
  } catch {
    return {
      path: memoryPath,
      exists: false,
      modified: null,
      size: null,
      writeAuthority: familiarId === "main" ? "workspace" : "familiar",
    };
  }
}

async function collectDreamArtifact(filePath: string): Promise<DreamArtifactSummary> {
  try {
    const [raw, s] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = parsed.entries;
    return {
      path: filePath,
      exists: true,
      modified: s.mtime.toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      entryCount:
        entries && typeof entries === "object" && !Array.isArray(entries)
          ? Object.keys(entries).length
          : Array.isArray(entries)
            ? entries.length
            : 0,
      topLevelKeys: Object.keys(parsed).slice(0, 8),
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      modified: null,
      updatedAt: null,
      entryCount: 0,
      topLevelKeys: [],
    };
  }
}
