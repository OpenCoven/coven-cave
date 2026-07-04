import { readFile } from "node:fs/promises";
import path from "node:path";

import { scanSkillsDir, scanClaudeUserSkills, type LocalSkillEntry } from "@/lib/server/skill-scan";

export type SkillDirectoryTrust = {
  official: boolean;
  audited: boolean;
  source: "registry" | "local" | "daemon" | "fallback";
};

export type SkillDirectoryInstalled = {
  installed: boolean;
  path?: string;
  version?: string;
  scope: "coven" | "claude-user" | "other-local";
  source: "local-scan" | "local-match";
};

export type SkillDirectoryEntry = {
  id: string;
  slug: string;
  name: string;
  owner?: string;
  repo?: string;
  packageName?: string;
  description?: string;
  tags: string[];
  topics: string[];
  agents: string[];
  trust: SkillDirectoryTrust;
  installed: boolean;
  local?: SkillDirectoryInstalled;
  installsAllTime: number;
  trendScore: number;
  hotScore: number;
  registryUrl?: string;
  sourceUrl?: string;
  source: "registry" | "daemon" | "fallback";
};

export type SkillDirectoryListResponse = {
  ok: boolean;
  source: "live" | "fallback";
  reason?: string;
  fetchedAt: string;
  entries: SkillDirectoryEntry[];
};

type RawDirectoryEntry = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  owner?: unknown;
  repo?: unknown;
  package?: unknown;
  packageName?: unknown;
  description?: unknown;
  tags?: unknown;
  topics?: unknown;
  agents?: unknown;
  trust?: unknown;
  installsAllTime?: unknown;
  installs?: unknown;
  trend?: unknown;
  hot?: unknown;
  registryUrl?: unknown;
  sourceUrl?: unknown;
  source?: unknown;
};

const DIRECTORY_FALLBACK_PATH = path.join(
  process.cwd(),
  "src",
  "app",
  "api",
  "skills",
  "directory",
  "fallback.json",
);

const FALLBACK_AGENTS = new Set([
  "codex",
  "claude-code",
  "cursor",
  "copilot",
  "windsurf",
  "gemini",
  "r1",
  "sonnet",
]);

function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
  return [...new Set(out)];
}

function toSlug(owner: string | undefined, repo: string | undefined, fallbackId: string): string {
  if (owner && repo) return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  return norm(fallbackId);
}

function localScope(value: string): "coven" | "claude-user" | "other-local" {
  return value === "user" ? "claude-user" : "coven";
}

function trustFromRaw(value: unknown): SkillDirectoryTrust {
  if (!value || typeof value !== "object") {
    return { official: false, audited: false, source: "fallback" };
  }
  const raw = value as {
    official?: unknown;
    audited?: unknown;
    source?: unknown;
  };
  return {
    official: asBool(raw.official, false),
    audited: asBool(raw.audited, false),
    source: raw.source === "local" || raw.source === "daemon" || raw.source === "registry" || raw.source === "fallback"
      ? raw.source
      : "fallback",
  };
}

function normalizeRawEntry(raw: RawDirectoryEntry): SkillDirectoryEntry | null {
  const id = asString(raw.id) ?? asString(raw.slug);
  if (!id) return null;
  const name = asString(raw.name) ?? id;
  const owner = asString(raw.owner);
  const repo = asString(raw.repo);
  const packageName = asString(raw.packageName) ?? asString(raw.package);
  const slug = toSlug(owner, repo, id);

  return {
    id,
    slug,
    name,
    owner,
    repo,
    packageName,
    description: asString(raw.description),
    tags: asStringList(raw.tags),
    topics: asStringList(raw.topics),
    agents: asStringList(raw.agents),
    trust: trustFromRaw(raw.trust),
    installed: false,
    installsAllTime: typeof raw.installsAllTime === "number" && Number.isFinite(raw.installsAllTime)
      ? raw.installsAllTime
      : typeof raw.installs === "number" && Number.isFinite(raw.installs)
        ? raw.installs
        : 0,
    trendScore: typeof raw.trend === "number" && Number.isFinite(raw.trend) ? raw.trend : 0,
    hotScore: typeof raw.hot === "number" && Number.isFinite(raw.hot) ? raw.hot : 0,
    registryUrl: asString(raw.registryUrl),
    sourceUrl: asString(raw.sourceUrl),
    source: raw.source === "daemon" ? "daemon" : "registry",
  };
}

function ownerRepoKey(entry: { owner?: string; repo?: string; slug?: string }): string {
  const owner = norm(entry.owner);
  const repo = norm(entry.repo);
  if (owner && repo) return `${owner}/${repo}`;
  return norm(entry.slug);
}

function matchesByOrder(entry: SkillDirectoryEntry, local: LocalSkillEntry, order: number): boolean {
  const localSlug = ownerRepoKey(local);
  const targetSlug = ownerRepoKey(entry);
  const localPackage = norm(local.packageName);
  const entryPackage = norm(entry.packageName);

  if (order === 0 && localSlug && targetSlug && localSlug === targetSlug) return true;
  if (order === 1 && local.owner && local.repo) {
    return entry.owner?.toLowerCase() === local.owner.toLowerCase() &&
      entry.repo?.toLowerCase() === local.repo.toLowerCase();
  }
  if (order === 2 && localPackage && entryPackage) return localPackage === entryPackage;
  if (order === 3 && norm(local.id) === norm(entry.id)) return true;
  if (order === 4 && norm(local.name) === norm(entry.name)) return true;
  return false;
}

function chooseLocalMatch(entry: SkillDirectoryEntry, locals: LocalSkillEntry[], consumed: Set<number>): LocalSkillEntry | null {
  for (let step = 0; step <= 4; step++) {
    for (let i = 0; i < locals.length; i++) {
      if (consumed.has(i)) continue;
      if (matchesByOrder(entry, locals[i], step)) {
        consumed.add(i);
        return locals[i];
      }
    }
  }
  return null;
}

function attachLocalState(entry: SkillDirectoryEntry, local: LocalSkillEntry | null): SkillDirectoryEntry {
  if (!local) return entry;
  return {
    ...entry,
    installed: true,
    local: {
      installed: true,
      path: local.path,
      version: local.version,
      scope: localScope(local.familiar),
      source: "local-match",
    },
    // registry trust is not overridden by local metadata; but local-only installs
    // for remote rows should still inherit the authoritative registry source.
  };
}

function addInstalledLocalOnly(entry: LocalSkillEntry): SkillDirectoryEntry {
  const slug = ownerRepoKey({ owner: entry.owner, repo: entry.repo, slug: entry.id });
  return {
    id: entry.id,
    slug,
    name: entry.name,
    owner: entry.owner,
    repo: entry.repo,
    packageName: entry.packageName,
    description: entry.description,
    tags: entry.tags ?? [],
    topics: entry.topics ?? [],
    agents: entry.agents ?? [],
    trust: {
      official: false,
      audited: false,
      source: "local",
    },
    installed: true,
    local: {
      installed: true,
      path: entry.path,
      version: entry.version,
      scope: localScope(entry.familiar),
      source: "local-scan",
    },
    installsAllTime: 0,
    trendScore: 0,
    hotScore: 0,
    source: "fallback",
  };
}

function uniqueEntries(entries: SkillDirectoryEntry[]): SkillDirectoryEntry[] {
  const out: SkillDirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.slug}:${entry.id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

async function readFallbackEntries(): Promise<SkillDirectoryEntry[]> {
  try {
    const raw = await readFile(DIRECTORY_FALLBACK_PATH, "utf8");
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (!Array.isArray(parsed?.entries)) return [];
    const out: SkillDirectoryEntry[] = [];
    for (const item of parsed.entries) {
      const normalized = normalizeRawEntry(item as RawDirectoryEntry);
      if (normalized) out.push(normalized);
    }
    return out;
  } catch {
    return [];
  }
}

async function readLiveEntries(): Promise<SkillDirectoryEntry[]> {
  const endpoint = process.env.SKILLS_DIRECTORY_ENDPOINT?.trim();
  const token = process.env.SKILLS_DIRECTORY_TOKEN?.trim();
  if (!endpoint) return [];
  const url = new URL(endpoint);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) return [];
  const parsed = (await response.json()) as { data?: unknown; entries?: unknown };
  const source = parsed?.entries ?? parsed?.data;
  if (!Array.isArray(source)) return [];
  const normalized = source.map((item) => normalizeRawEntry(item as RawDirectoryEntry)).filter((item) => item !== null);
  return normalized;
}

export async function listSkillDirectoryEntries(): Promise<SkillDirectoryListResponse> {
  const live = await readLiveEntries();
  const source: SkillDirectoryListResponse["source"] = live.length > 0 ? "live" : "fallback";
  const fallback = source === "fallback" ? await readFallbackEntries() : [];
  const entries = live.length > 0 ? live : fallback;
  const reason = source === "fallback"
    ? (fallback.length > 0 ? "Using bundled fallback directory fixture." : "Directory source unavailable.")
    : undefined;

  return {
    ok: true,
    source,
    reason,
    fetchedAt: new Date().toISOString(),
    entries: uniqueEntries(entries),
  };
}

function isDirectoryMatch(entry: SkillDirectoryEntry, key: string): boolean {
  const target = norm(key);
  return (
    norm(entry.slug) === target ||
    norm(entry.id) === target ||
    `${norm(entry.owner)}/${norm(entry.repo)}` === target ||
    `${norm(entry.id)}` === target
  );
}

export async function listSkillDirectoryEntriesWithLocal(): Promise<SkillDirectoryListResponse> {
  const locals: LocalSkillEntry[] = [];
  const global = await scanSkillsDir(path.join(process.cwd(), ".coven"), "global", locals);
  await scanClaudeUserSkills().then((items) => locals.push(...items));

  const directory = await listSkillDirectoryEntries();
  const merged = mergeDirectoryWithLocal(directory.entries, locals);
  return {
    ...directory,
    entries: merged,
  };
}

export function mergeDirectoryWithLocal(
  entries: SkillDirectoryEntry[],
  locals: LocalSkillEntry[],
): SkillDirectoryEntry[] {
  const consumed = new Set<number>();
  const matched = entries.map((entry) => attachLocalState(entry, chooseLocalMatch(entry, locals, consumed)));
  const localOnly: SkillDirectoryEntry[] = locals
    .map((local, index) => (consumed.has(index) ? null : addInstalledLocalOnly(local)))
    .filter((entry): entry is SkillDirectoryEntry => entry !== null);
  return uniqueEntries([...matched, ...localOnly]);
}

export function matchDirectoryEntry(
  key: string,
  entries: SkillDirectoryEntry[],
): SkillDirectoryEntry | null {
  const match = entries.find((entry) => isDirectoryMatch(entry, key));
  return match ?? null;
}

export function fallbackAgentsForDirectory(): string[] {
  return [...FALLBACK_AGENTS];
}

export function allowedSkillInstallAgents(): string[] {
  return [...FALLBACK_AGENTS];
}
