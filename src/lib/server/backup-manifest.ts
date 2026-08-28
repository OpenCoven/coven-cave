import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { caveHome, covenHome } from "@/lib/coven-paths";

export type BackupRoot = "coven" | "cave";

export type BackupEntry = {
  root: BackupRoot;
  path: string;
  bytes: number;
  sha256: string;
  secret: boolean;
  optional?: boolean;
};

export type BackupSourceIdentity = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

export type BackupSourceDirectoryIdentity = {
  path: string;
  dev: number;
  ino: number;
};

export type BackupSourceFile = {
  root: BackupRoot;
  rel: string;
  secret: boolean;
  optional?: boolean;
  fullPath: string;
  identity?: BackupSourceIdentity;
  ancestorIdentities?: BackupSourceDirectoryIdentity[];
};

export type BackupManifest = {
  version: 1;
  createdAt: string;
  roots: Record<BackupRoot, string>;
  entries: BackupEntry[];
  totals: { files: number; bytes: number };
  secretsPolicy: {
    vaultKey: "include-passphrase-wrapped";
    plaintextSecrets: "encrypted-envelope-only";
  };
  excluded: string[];
  knownGaps: string[];
};

type Candidate = {
  root: BackupRoot;
  rel: string;
  secret?: boolean;
  optional?: boolean;
};

const CAVE_FILES = [
  "config.json",
  "state.json",
  "board.json",
  "inbox.json",
  "inbox-prefs.json",
  "canvas.json",
  "projects.json",
  "queue-project.json",
  "project-permissions.json",
  "permission-config.json",
  "removed-familiars.json",
  "preferences.json",
  "theme.json",
  "mobile-paired.json",
  "backup-sync.json",
  "automation-runs.json",
  "workflow-runs.json",
  "salem-pathfinder.json",
  "research-links.json",
  "message-feedback.json",
  "backdrop.jpg",
  "vault.yaml",
] as const;

const CAVE_DIRS = [
  "conversations",
  "research-missions",
  "backdrops",
  "workflows",
  "flows",
  "run-histories",
  "research-resources/manifests",
  "research-resources/snapshots",
  "research-resources/blobs",
  "research-resources/tombstones",
  "research-resources/migration",
] as const;

const COVEN_FILES = [
  "familiars.toml",
  "rss-feeds.json",
  "opencoven-submissions.json",
] as const;

const COVEN_DIRS = [
  "journal",
  "knowledge",
  "library",
  "prompts",
  "skills",
  "roles",
  "workflows",
  "flows",
  "automation-run-logs",
  "memory",
] as const;

const SECRET_FILES: Candidate[] = [
  { root: "cave", rel: "local-vault.enc.json", secret: true },
  { root: "cave", rel: "local-vault.key", secret: true },
  { root: "cave", rel: ".env.local", secret: true, optional: true },
];

const EXCLUDED_NAMES = new Set([
  "coven.sqlite3",
  "coven.sqlite3-shm",
  "coven.sqlite3-wal",
  "workspaces",
  "workspace",
  "logs",
  "sockets",
  "archives",
  ".git",
]);

const EXCLUDED_SUFFIXES = [".sock", ".lock", ".log", ".tmp", ".bak"];

export const BACKUP_KNOWN_GAPS = [
  "Browser-profile state (avatar/backdrop IndexedDB images and localStorage preferences) is not on disk and is not included in P1 backups.",
];

export function backupRoots(): Record<BackupRoot, string> {
  return { coven: path.resolve(covenHome()), cave: path.resolve(caveHome()) };
}

export function normalizeBackupPath(rel: string): string {
  const normalized = rel.split(path.sep).join("/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) throw new Error("backup path is invalid");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("backup path is invalid");
  }
  return parts.join("/");
}

function rootPath(root: BackupRoot, roots = backupRoots()): string {
  return roots[root];
}

export function resolveBackupEntryPath(root: BackupRoot, rel: string, roots = backupRoots()): string {
  const base = rootPath(root, roots);
  const resolved = path.resolve(base, normalizeBackupPath(rel));
  if (!(resolved === base || resolved.startsWith(base + path.sep))) {
    throw new Error("backup path not allowed");
  }
  return resolved;
}

function isExcludedRel(rel: string): boolean {
  const normalized = rel.split(path.sep).join("/");
  const name = normalized.split("/").at(-1) ?? normalized;
  return EXCLUDED_NAMES.has(name) || EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function baseCandidates(): Candidate[] {
  return [
    ...CAVE_FILES.map((rel) => ({ root: "cave" as const, rel })),
    ...CAVE_DIRS.map((rel) => ({ root: "cave" as const, rel })),
    ...COVEN_FILES.map((rel) => ({ root: "coven" as const, rel })),
    ...COVEN_DIRS.map((rel) => ({ root: "coven" as const, rel })),
    ...SECRET_FILES,
  ];
}

export function isAllowedBackupEntry(root: BackupRoot, rel: string): boolean {
  const normalized = normalizeBackupPath(rel);
  if (isExcludedRel(normalized)) return false;
  return baseCandidates().some((candidate) => {
    if (candidate.root !== root) return false;
    const base = normalizeBackupPath(candidate.rel);
    return normalized === base || normalized.startsWith(`${base}/`);
  });
}

async function collectFiles(candidate: Candidate, roots: Record<BackupRoot, string>): Promise<Array<{ root: BackupRoot; rel: string; secret: boolean; optional?: boolean }>> {
  const full = resolveBackupEntryPath(candidate.root, candidate.rel, roots);
  const privateResearch = candidate.root === "cave" && candidate.rel.startsWith("research-resources/");
  let s;
  try {
    s = privateResearch ? await lstat(full) : await stat(full);
  } catch (error) {
    if (privateResearch && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
  if (privateResearch && s.isSymbolicLink()) throw new Error("Research backup path is unsafe");
  if (privateResearch && !s.isDirectory()) throw new Error("Research backup path is unsafe");
  if (s.isFile()) return [{ root: candidate.root, rel: normalizeBackupPath(candidate.rel), secret: candidate.secret === true, optional: candidate.optional }];
  if (!s.isDirectory()) return [];

  const out: Array<{ root: BackupRoot; rel: string; secret: boolean; optional?: boolean }> = [];
  async function walk(dirRel: string): Promise<void> {
    const dir = resolveBackupEntryPath(candidate.root, dirRel, roots);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const childRel = normalizeBackupPath(`${dirRel}/${entry.name}`);
      if (isExcludedRel(childRel)) continue;
      const child = resolveBackupEntryPath(candidate.root, childRel, roots);
      if (privateResearch) {
        const metadata = await lstat(child);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()) || (metadata.isFile() && metadata.nlink !== 1)) {
          throw new Error("Research backup entry is unsafe");
        }
        if (metadata.isDirectory()) await walk(childRel);
        else out.push({ root: candidate.root, rel: childRel, secret: candidate.secret === true });
        continue;
      }
      if (entry.isDirectory()) await walk(childRel);
      else if (entry.isFile()) out.push({ root: candidate.root, rel: childRel, secret: candidate.secret === true });
      else await stat(child).catch(() => null);
    }
  }
  await walk(candidate.rel);
  return out.sort((a, b) => `${a.root}/${a.rel}`.localeCompare(`${b.root}/${b.rel}`));
}

async function researchAncestorIdentities(
  fullPath: string,
  caveRoot: string,
): Promise<BackupSourceDirectoryIdentity[]> {
  const relativeParent = path.relative(caveRoot, path.dirname(fullPath));
  if (relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) {
    throw new Error("Research backup entry escapes its root");
  }
  const directories = [caveRoot];
  let current = caveRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    directories.push(current);
  }
  const identities: BackupSourceDirectoryIdentity[] = [];
  for (const directory of directories) {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Research backup directory is unsafe");
    }
    identities.push({ path: directory, dev: metadata.dev, ino: metadata.ino });
  }
  return identities;
}

export async function listBackupFiles(roots = backupRoots()): Promise<BackupSourceFile[]> {
  const seen = new Set<string>();
  const files: BackupSourceFile[] = [];
  for (const candidate of baseCandidates()) {
    for (const file of await collectFiles(candidate, roots)) {
      if (!isAllowedBackupEntry(file.root, file.rel)) continue;
      const key = `${file.root}:${file.rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fullPath = resolveBackupEntryPath(file.root, file.rel, roots);
      const privateResearch = file.root === "cave" && file.rel.startsWith("research-resources/");
      const metadata = privateResearch ? await lstat(fullPath) : null;
      if (metadata && (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)) {
        throw new Error("Research backup entry is unsafe");
      }
      files.push({
        ...file,
        fullPath,
        ...(metadata ? {
          identity: {
            dev: metadata.dev,
            ino: metadata.ino,
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
            ctimeMs: metadata.ctimeMs,
          },
          ancestorIdentities: await researchAncestorIdentities(
            fullPath,
            roots.cave,
          ),
        } : {}),
      });
    }
  }
  return files.sort((a, b) => `${a.root}/${a.rel}`.localeCompare(`${b.root}/${b.rel}`));
}

export const RESEARCH_BACKUP_EXCLUSIONS = [
  "research-resources/jobs/", "research-resources/failures/",
  "research-resources/fences/", "research-resources/deletions/",
  "research-resources/locks/", "research-resources/index/",
] as const;

export function createBackupManifest(entries: BackupEntry[], roots = backupRoots(), createdAt = new Date().toISOString()): BackupManifest {
  const sorted = [...entries].sort((a, b) => `${a.root}/${a.path}`.localeCompare(`${b.root}/${b.path}`));
  return {
    version: 1,
    createdAt,
    roots,
    entries: sorted,
    totals: { files: sorted.length, bytes: sorted.reduce((sum, entry) => sum + entry.bytes, 0) },
    secretsPolicy: {
      vaultKey: "include-passphrase-wrapped",
      plaintextSecrets: "encrypted-envelope-only",
    },
    excluded: [
      "coven.sqlite3", "workspaces/", "logs/", "sockets/", "archives/",
      "*.sock", "*.lock", "*.log",
      ...RESEARCH_BACKUP_EXCLUSIONS,
    ],
    knownGaps: BACKUP_KNOWN_GAPS,
  };
}
