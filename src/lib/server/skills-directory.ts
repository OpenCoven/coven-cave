import { readFile } from "node:fs/promises";
import path from "node:path";

import { covenHome } from "@/lib/coven-paths";
import {
  dedupeByRealPath,
  scanAgentSharedSkills,
  scanClaudeUserSkills,
  scanCodexUserSkills,
  scanSkillsDir,
  type LocalSkillEntry,
} from "@/lib/server/skill-scan";

export type SkillDirectoryTrust = {
  official: boolean;
  audited: boolean;
  source: "registry" | "local" | "daemon" | "fallback";
};

export type SkillDirectoryInstalled = {
  installed: boolean;
  path?: string;
  version?: string;
  scope: "coven" | "claude-user" | "codex-user" | "agents-project" | "agents-user" | "other-local";
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
  weeklyInstalls: number[];
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

export type SkillDirectoryPreview = {
  text: string;
  source: "github-raw";
  url: string;
  fetchedAt: string;
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
  weeklyInstalls?: unknown;
  trend?: unknown;
  hot?: unknown;
  registryUrl?: unknown;
  sourceUrl?: unknown;
  source?: unknown;
};

type RawSkillsShEntry = {
  id?: unknown;
  source?: unknown;
  skillId?: unknown;
  name?: unknown;
  installs?: unknown;
  weeklyInstalls?: unknown;
  isOfficial?: unknown;
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

const SKILLS_SH_DIRECTORY_URL = "https://www.skills.sh/";
const SKILLS_SH_SEARCH_URL = "https://www.skills.sh/api/search";
const SKILLS_SH_CACHE_MS = 10 * 60 * 1000;
const SKILLS_SH_MAX_ENTRIES = 500;
const SKILLS_SH_SEARCH_MAX_ENTRIES = 100;
const REMOTE_SKILL_MARKDOWN_MAX_BYTES = 512 * 1024;
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
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
let skillsShCache: { expiresAt: number; entries: SkillDirectoryEntry[] } | null = null;
const skillsShSearchCache = new Map<string, { expiresAt: number; entries: SkillDirectoryEntry[] }>();
const remoteMarkdownCache = new Map<string, { expiresAt: number; preview: SkillDirectoryPreview | null }>();

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

function asNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
}

function toSlug(owner: string | undefined, repo: string | undefined, fallbackId: string): string {
  if (owner && repo) return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  return norm(fallbackId);
}

function localScope(value: LocalSkillEntry["familiar"]): SkillDirectoryInstalled["scope"] {
  if (value === "global") return "coven";
  if (value === "user") return "claude-user";
  if (value === "codex-user") return "codex-user";
  if (value === "agents-project") return "agents-project";
  if (value === "agents-user") return "agents-user";
  return "other-local";
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
  const weeklyInstalls = asNumberList(raw.weeklyInstalls).slice(-8);

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
    weeklyInstalls,
    trendScore: typeof raw.trend === "number" && Number.isFinite(raw.trend) ? raw.trend : 0,
    hotScore: typeof raw.hot === "number" && Number.isFinite(raw.hot) ? raw.hot : 0,
    registryUrl: asString(raw.registryUrl),
    sourceUrl: asString(raw.sourceUrl),
    source: raw.source === "daemon" ? "daemon" : "registry",
  };
}

function normalizeSkillsShEntry(raw: RawSkillsShEntry): SkillDirectoryEntry | null {
  const source = asString(raw.source);
  const id = asString(raw.skillId) ?? asString(raw.name) ?? asString(raw.id)?.split("/").filter(Boolean).pop();
  if (!source || !id) return null;
  const sourceParts = source.split("/").filter(Boolean);
  const owner = sourceParts.length >= 2 ? sourceParts[0] : undefined;
  const repo = sourceParts.length >= 2 ? sourceParts[1] : undefined;
  const weekly = asNumberList(raw.weeklyInstalls).slice(-8);
  const weeklyTotal = weekly.reduce((sum, value) => sum + value, 0);
  const latestWeek = weekly.length > 0 ? weekly[weekly.length - 1] : 0;
  const installs = typeof raw.installs === "number" && Number.isFinite(raw.installs) ? raw.installs : 0;
  const official = asBool(raw.isOfficial, false);
  const slug = owner && repo
    ? `${owner.toLowerCase()}/${repo.toLowerCase()}/${id.toLowerCase()}`
    : `${source.toLowerCase()}/${id.toLowerCase()}`;
  return {
    id,
    slug,
    name: asString(raw.name) ?? id,
    owner,
    repo,
    packageName: source,
    tags: [],
    topics: [],
    agents: fallbackAgentsForDirectory(),
    trust: {
      official,
      audited: false,
      source: "registry",
    },
    installed: false,
    installsAllTime: installs,
    weeklyInstalls: weekly,
    trendScore: weeklyTotal,
    hotScore: latestWeek,
    registryUrl: `${SKILLS_SH_DIRECTORY_URL}${source}/${id}`,
    sourceUrl: owner && repo ? `https://github.com/${source}` : undefined,
    source: "registry",
  };
}

function normalizeSearchQuery(query: string | undefined | null): string {
  return (query ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
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
    weeklyInstalls: [],
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
  if (!endpoint) return readSkillsShEntries();
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

function extractBalancedArray(text: string, marker: string): string | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("[", markerIndex);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function decodeNextFlightJsonArray(arrayText: string): unknown[] {
  const normalized = arrayText
    .replace(/\\"/g, "\"")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  const parsed = JSON.parse(normalized) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

export function parseSkillsShDirectoryHtml(html: string): SkillDirectoryEntry[] {
  const payload =
    extractBalancedArray(html, "\\\"initialSkills\\\":[") ??
    extractBalancedArray(html, "\"initialSkills\":[") ??
    extractBalancedArray(html, "\\\"skills\\\":[") ??
    extractBalancedArray(html, "\"skills\":[");
  if (!payload) return [];
  try {
    return decodeNextFlightJsonArray(payload)
      .map((entry) => normalizeSkillsShEntry(entry as RawSkillsShEntry))
      .filter((entry): entry is SkillDirectoryEntry => entry !== null)
      .slice(0, SKILLS_SH_MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function parseSkillsShSearchResponse(payload: unknown): SkillDirectoryEntry[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = payload as { skills?: unknown };
  if (!Array.isArray(raw.skills)) return [];
  return raw.skills
    .map((entry) => normalizeSkillsShEntry(entry as RawSkillsShEntry))
    .filter((entry): entry is SkillDirectoryEntry => entry !== null)
    .slice(0, SKILLS_SH_SEARCH_MAX_ENTRIES);
}

async function readSkillsShEntries(): Promise<SkillDirectoryEntry[]> {
  const now = Date.now();
  if (skillsShCache && skillsShCache.expiresAt > now) return skillsShCache.entries;
  try {
    const response = await fetch(SKILLS_SH_DIRECTORY_URL, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const entries = parseSkillsShDirectoryHtml(html);
    if (entries.length > 0) {
      skillsShCache = { expiresAt: now + SKILLS_SH_CACHE_MS, entries };
    }
    return entries;
  } catch {
    return [];
  }
}

async function readSkillsShSearchEntries(query: string): Promise<SkillDirectoryEntry[]> {
  const q = normalizeSearchQuery(query);
  if (!q) return readSkillsShEntries();
  const key = q.toLowerCase();
  const now = Date.now();
  const cached = skillsShSearchCache.get(key);
  if (cached && cached.expiresAt > now) return cached.entries;
  try {
    const url = new URL(SKILLS_SH_SEARCH_URL);
    url.searchParams.set("q", q);
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const entries = parseSkillsShSearchResponse(await response.json());
    skillsShSearchCache.set(key, { expiresAt: now + SKILLS_SH_CACHE_MS, entries });
    return entries;
  } catch {
    return [];
  }
}

function matchesEntryQuery(entry: SkillDirectoryEntry, query: string): boolean {
  const q = normalizeSearchQuery(query).toLowerCase();
  if (!q) return true;
  const hay = [
    entry.id,
    entry.slug,
    entry.name,
    entry.owner,
    entry.repo,
    entry.packageName,
    entry.description,
    ...(entry.tags ?? []),
    ...(entry.topics ?? []),
    ...(entry.agents ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

export async function listSkillDirectoryEntries(query?: string): Promise<SkillDirectoryListResponse> {
  const q = normalizeSearchQuery(query);
  const live = q ? await readSkillsShSearchEntries(q) : await readLiveEntries();
  const source: SkillDirectoryListResponse["source"] = live.length > 0 ? "live" : "fallback";
  const fallback = source === "fallback"
    ? (q ? (await readFallbackEntries()).filter((entry) => matchesEntryQuery(entry, q)) : await readFallbackEntries())
    : [];
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

function sourceMatches(entry: SkillDirectoryEntry, source: string | null | undefined): boolean {
  const target = norm(source);
  if (!target) return true;
  return ownerRepoKey(entry) === target || norm(entry.packageName) === target;
}

function isDirectoryMatch(entry: SkillDirectoryEntry, key: string, source?: string | null): boolean {
  if (!sourceMatches(entry, source)) return false;
  const target = norm(key);
  return (
    norm(entry.slug) === target ||
    norm(entry.id) === target ||
    `${norm(entry.owner)}/${norm(entry.repo)}` === target ||
    `${norm(entry.id)}` === target
  );
}

export async function listSkillDirectoryEntriesWithLocal(query?: string): Promise<SkillDirectoryListResponse> {
  const q = normalizeSearchQuery(query);
  const rawLocals: LocalSkillEntry[] = [];
  await scanSkillsDir(path.join(covenHome(), "skills"), "global", rawLocals);
  await scanClaudeUserSkills().then((items) => rawLocals.push(...items));
  await scanCodexUserSkills().then((items) => rawLocals.push(...items));
  await scanAgentSharedSkills().then((items) => rawLocals.push(...items));
  // One physical skill can sit under several roots (~/.claude/skills symlinks
  // into ~/.agents/skills) — collapse those before the directory merge so the
  // browser doesn't list the same install twice.
  const locals = await dedupeByRealPath(rawLocals);

  const directory = await listSkillDirectoryEntries(q);
  const merged = mergeDirectoryWithLocal(directory.entries, locals);
  return {
    ...directory,
    entries: q ? merged.filter((entry) => entry.source !== "fallback" || matchesEntryQuery(entry, q)) : merged,
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
  source?: string | null,
): SkillDirectoryEntry | null {
  const match = entries.find((entry) => isDirectoryMatch(entry, key, source));
  return match ?? null;
}

function isSafeGitHubSegment(value: string | undefined): value is string {
  return typeof value === "string" && GITHUB_SEGMENT_RE.test(value);
}

function addSkillFolderCandidate(candidates: string[], value: string | undefined): void {
  if (!value || !isSafeGitHubSegment(value) || candidates.includes(value)) return;
  candidates.push(value);
}

function sourcePrefixTokens(entry: Pick<SkillDirectoryEntry, "owner" | "repo">): string[] {
  const values = [entry.owner, entry.repo].filter((value): value is string => typeof value === "string");
  const tokens = values.flatMap((value) => value.split(/[-_.]/g)).filter((token) => token.length >= 2);
  return [...new Set(tokens)];
}

export function remoteSkillMarkdownUrls(entry: Pick<SkillDirectoryEntry, "owner" | "repo" | "id">): string[] {
  if (!isSafeGitHubSegment(entry.owner) || !isSafeGitHubSegment(entry.repo) || !isSafeGitHubSegment(entry.id)) {
    return [];
  }
  const folderCandidates: string[] = [];
  addSkillFolderCandidate(folderCandidates, entry.id);
  for (const token of sourcePrefixTokens(entry)) {
    const prefix = `${token}-`;
    if (entry.id.startsWith(prefix)) {
      addSkillFolderCandidate(folderCandidates, entry.id.slice(prefix.length));
    }
  }
  return folderCandidates.map((folder) =>
    `https://raw.githubusercontent.com/${entry.owner}/${entry.repo}/main/skills/${folder}/SKILL.md`
  );
}

export function remoteSkillMarkdownUrl(entry: Pick<SkillDirectoryEntry, "owner" | "repo" | "id">): string | null {
  return remoteSkillMarkdownUrls(entry)[0] ?? null;
}

export async function readRemoteSkillMarkdown(entry: SkillDirectoryEntry): Promise<SkillDirectoryPreview | null> {
  const urls = remoteSkillMarkdownUrls(entry);
  if (urls.length === 0) return null;
  const now = Date.now();
  for (const url of urls) {
    const cached = remoteMarkdownCache.get(url);
    if (cached && cached.expiresAt > now) {
      if (cached.preview) return cached.preview;
      continue;
    }
    try {
      const response = await fetch(url, {
        headers: { accept: "text/plain" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        remoteMarkdownCache.set(url, { expiresAt: now + SKILLS_SH_CACHE_MS, preview: null });
        continue;
      }
      const text = (await response.text()).slice(0, REMOTE_SKILL_MARKDOWN_MAX_BYTES);
      const preview: SkillDirectoryPreview = {
        text,
        source: "github-raw",
        url,
        fetchedAt: new Date().toISOString(),
      };
      remoteMarkdownCache.set(url, { expiresAt: now + SKILLS_SH_CACHE_MS, preview });
      return preview;
    } catch {
      remoteMarkdownCache.set(url, { expiresAt: now + SKILLS_SH_CACHE_MS, preview: null });
    }
  }
  return null;
}

export function fallbackAgentsForDirectory(): string[] {
  return [...FALLBACK_AGENTS];
}

export function allowedSkillInstallAgents(): string[] {
  return [...FALLBACK_AGENTS];
}
