/**
 * Knowledge Vault — curated, cross-harness reference knowledge.
 *
 * The Knowledge Vault is deliberately SEPARATE from the memory system:
 *
 *   - Memory (`~/.coven/.../memory/*.md`) is the agent's own evolving notebook —
 *     written by familiars as they work, scoped per-familiar-per-day, and meant
 *     to drift over time.
 *   - The Knowledge Vault (`~/.coven/knowledge/*.md`) is durable, human-curated
 *     reference material — style guides, glossaries, domain facts, API contracts
 *     — that the user wants every harness to treat as authoritative background.
 *
 * The "tie-in" is the prompt-construction layer in `/api/chat/send`: every
 * harness (claude, codex, hermes, openclaw) is spawned with a single
 * constructed prompt, so wrapping that prompt with the vault block delivers the
 * same curated knowledge to all of them — no per-harness plumbing required.
 *
 * Storage: one Markdown file per entry under `~/.coven/knowledge/`, each with a
 * small YAML frontmatter block:
 *
 *     ---
 *     title: API Style Guide
 *     tags: [api, conventions]
 *     scope: global            # or a list/space-separated set of familiar ids
 *     enabled: true
 *     ---
 *     Body markdown…
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { KnowledgeCollectionMeta } from "../knowledge-pack-types.ts";
import { covenHome } from "../coven-paths.ts";
import { normalizePinRefs, type StitchPinRef } from "../stitch.ts";

// ── Paths & id guard ────────────────────────────────────────────────────────

/** Root directory for vault entries. Overridable for tests/bundles. */
export function covenKnowledgeRoot(): string {
  return process.env.COVEN_KNOWLEDGE_DIR || path.join(covenHome(), "knowledge");
}

const KNOWLEDGE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Strict slug guard — the id is the only user input that hits the filesystem,
 *  so it must never contain separators, dots, or anything path-traversing. */
export function isValidKnowledgeId(id: unknown): id is string {
  return typeof id === "string" && KNOWLEDGE_ID_RE.test(id);
}

export function isValidCollectionId(id: unknown): id is string {
  return typeof id === "string" && KNOWLEDGE_ID_RE.test(id);
}

/** Derive a safe id from a free-form title (best-effort; may be empty). */
export function slugifyKnowledgeId(title: string): string {
  // Cap length first, then collapse non-slug runs. The leading/trailing dashes
  // are trimmed with index walks rather than an anchored `/-+$/` regex, which
  // backtracks quadratically on long dash runs (ReDoS).
  const collapsed = title.slice(0, 200).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start += 1;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  return collapsed.slice(start, end).slice(0, 64);
}

// ── Types ───────────────────────────────────────────────────────────────────

export type KnowledgeScope = "global" | string[];

export type KnowledgeEntry = {
  id: string;
  collection?: string;
  title: string;
  tags: string[];
  /** "global" → every familiar; otherwise an explicit familiar-id allow-list. */
  scope: KnowledgeScope;
  enabled: boolean;
  body: string;
  /** Unknown frontmatter keys, preserved verbatim across server round-trips. */
  extra?: Record<string, unknown>;
  /** Stitch provenance: the pins this entry was sewn from (absent when the
   *  entry was written by hand). */
  pins?: StitchPinRef[];
};

// ── Parse / serialize (pure) ─────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/** Normalize an arbitrary `scope` field into "global" or a familiar-id list. */
export function normalizeScope(value: unknown): KnowledgeScope {
  if (value == null) return "global";
  const list = Array.isArray(value)
    ? value.map((v) => String(v).trim())
    : String(value)
        .split(/[,\s]+/)
        .map((v) => v.trim());
  const ids = list.filter(Boolean);
  if (ids.length === 0) return "global";
  if (ids.some((id) => id.toLowerCase() === "global" || id === "*" || id.toLowerCase() === "all")) {
    return "global";
  }
  return ids;
}

function extraFrontmatterLines(entry: KnowledgeEntry): string[] {
  const extra = sanitizeKnowledgeExtra(entry.extra);
  if (Object.keys(extra).length === 0) return [];
  // Keep empty lines: block scalars use blank lines for paragraph breaks, and
  // dropping them would silently corrupt multi-line values on every save. The
  // frontmatter fence stays unambiguous — block content is always indented, so
  // no emitted line can match the column-0 `---` terminator.
  return stringifyYaml(extra).trimEnd().split("\n");
}

const RESERVED_FRONTMATTER_KEYS = new Set(["title", "tags", "scope", "enabled", "pins"]);

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeKnowledgeExtra(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) out[key] = entry;
  }
  return out;
}

/** Parse one entry file's contents (frontmatter + body) into an entry. */
export function parseKnowledgeFile(id: string, raw: string, collection?: string): KnowledgeEntry {
  const match = raw.match(FRONTMATTER_RE);
  let front: Record<string, unknown> = {};
  let body = raw;
  if (match) {
    body = match[2] ?? "";
    try {
      const parsed = parseYaml(match[1]);
      if (parsed && typeof parsed === "object") front = parsed as Record<string, unknown>;
    } catch {
      // Malformed frontmatter → treat the whole file as body, keep title from id.
      front = {};
      body = raw;
    }
  }
  const pins = normalizePinRefs(front.pins);
  const extra = sanitizeKnowledgeExtra(front);
  return {
    id,
    ...(collection ? { collection } : {}),
    title: typeof front.title === "string" && front.title.trim() ? front.title.trim() : id,
    tags: normalizeTags(front.tags),
    scope: normalizeScope(front.scope),
    enabled: front.enabled !== false,
    body: body.trim(),
    ...(pins.length > 0 ? { pins } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** Serialize an entry back to its on-disk Markdown-with-frontmatter form. */
export function serializeKnowledgeEntry(entry: KnowledgeEntry): string {
  const scope = entry.scope === "global" ? "global" : entry.scope.join(", ");
  const lines = [
    "---",
    `title: ${JSON.stringify(entry.title)}`,
    `tags: [${entry.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
    `scope: ${JSON.stringify(scope)}`,
    `enabled: ${entry.enabled}`,
    // Stitch provenance rides along as a YAML list of compact pin refs.
    ...(entry.pins && entry.pins.length > 0
      ? [
          "pins:",
          ...entry.pins.map(
            (pin) =>
              `  - { kind: ${JSON.stringify(pin.kind)}, ref: ${JSON.stringify(pin.ref)}, title: ${JSON.stringify(pin.title)} }`,
          ),
        ]
      : []),
    ...extraFrontmatterLines(entry),
    "---",
    "",
    entry.body.trim(),
    "",
  ];
  return lines.join("\n");
}

// ── Selection & prompt block (pure) ──────────────────────────────────────────

/** Pick the entries that should reach a given familiar's harness prompt:
 *  enabled, and either global or explicitly scoped to that familiar. */
export function selectKnowledgeForFamiliar(
  entries: readonly KnowledgeEntry[],
  familiarId?: string,
): KnowledgeEntry[] {
  return entries.filter((entry) => {
    if (!entry.enabled) return false;
    if (entry.scope === "global") return true;
    return Boolean(familiarId) && entry.scope.includes(familiarId as string);
  });
}

/** Wrap a harness prompt with the Knowledge Vault block. Pure: same prompt back
 *  when there are no entries, so it's safe to call unconditionally. */
export function buildPromptWithKnowledgeVault(
  prompt: string,
  entries: readonly KnowledgeEntry[],
  collections: readonly { id: string; meta: KnowledgeCollectionMeta | null; count: number }[] = [],
): string {
  const text = prompt.trim();
  const usable = entries.filter((e) => e.enabled && e.body.trim());
  // collection.yml is hand-edited YAML; readCollectionMeta coerces types, but
  // this is a pure function other callers can feed raw metas — a non-string
  // summary must be skipped, never crash the chat-send path. Whitespace and
  // newlines are collapsed so a multi-line summary can't break the one-line
  // list format or balloon prompt tokens.
  const summaryOf = (meta: KnowledgeCollectionMeta | null): string =>
    meta && typeof meta.summary === "string" ? meta.summary.replace(/\s+/g, " ").trim() : "";
  const collectionIndex = collections
    .filter((collection) => summaryOf(collection.meta))
    .slice(0, 20)
    .map((collection) => `- ${collection.id}: ${summaryOf(collection.meta)}`);
  if (usable.length === 0 && collectionIndex.length === 0) return text;

  const blocks = usable.map((entry) => {
    const heading = entry.tags.length
      ? `## ${entry.title}  [tags: ${entry.tags.join(", ")}]`
      : `## ${entry.title}`;
    return [heading, entry.body.trim()].join("\n");
  });

  const context = [
    "<KNOWLEDGE_VAULT>",
    "Shared Knowledge Vault — curated reference knowledge available to every harness.",
    "This is durable, human-curated background material, NOT your evolving memory.",
    "Treat it as authoritative context for this conversation; do not edit it.",
    "",
    ...(collectionIndex.length > 0
      ? [
          "Collections index",
          ...collectionIndex,
          "",
        ]
      : []),
    ...blocks,
    "</KNOWLEDGE_VAULT>",
  ].join("\n\n");

  return text ? `${context}\n\n${text}` : context;
}

// ── Filesystem store ─────────────────────────────────────────────────────────

function collectionPath(collection: string): string {
  if (!isValidCollectionId(collection)) throw new Error("invalid knowledge collection");
  const root = path.resolve(covenKnowledgeRoot());
  const resolved = path.resolve(root, collection);
  if (!resolved.startsWith(root + path.sep) || path.dirname(resolved) !== root) {
    throw new Error("invalid knowledge collection");
  }
  return resolved;
}

function entryPath(id: string, collection?: string): string {
  if (!isValidKnowledgeId(id)) throw new Error("invalid knowledge id");
  if (collection !== undefined && !isValidCollectionId(collection)) {
    throw new Error("invalid knowledge collection");
  }
  // Single chokepoint where a vault path is built from the (slug-validated) id.
  // Resolve and assert containment directly under the vault root so a path can
  // never escape it, even if a caller forgets the id guard.
  const root = path.resolve(covenKnowledgeRoot());
  const parent = collection ? collectionPath(collection) : root;
  const resolved = path.resolve(parent, `${id}.md`);
  if (!resolved.startsWith(root + path.sep) || path.dirname(resolved) !== parent) {
    throw new Error("invalid knowledge id");
  }
  return resolved;
}

function collectionMetaPath(collection: string): string {
  return path.join(collectionPath(collection), "collection.yml");
}

/** List every vault entry on disk. Returns [] when the directory is absent or
 *  unreadable — the vault is an optional add-on, never a hard dependency. */
export async function listKnowledgeEntries(collection?: string): Promise<KnowledgeEntry[]> {
  if (collection !== undefined && !isValidCollectionId(collection)) return [];
  const root = covenKnowledgeRoot();
  let names: string[];
  try {
    names = await readdir(collection ? collectionPath(collection) : root);
  } catch {
    return [];
  }
  const entries: KnowledgeEntry[] = [];
  const scanRootEntries = async (dir: string, entryCollection?: string) => {
    let dirNames: string[];
    try {
      dirNames = await readdir(dir);
    } catch {
      return;
    }
    for (const name of dirNames.sort()) {
      if (name === "collection.yml" || !name.endsWith(".md")) continue;
      const id = name.slice(0, -3);
      if (!isValidKnowledgeId(id)) continue;
      try {
        const raw = await readFile(path.join(dir, name), "utf8");
        entries.push(parseKnowledgeFile(id, raw, entryCollection));
      } catch {
        // Skip unreadable entries rather than failing the whole list.
      }
    }
  };

  if (collection) {
    await scanRootEntries(collectionPath(collection), collection);
    return entries;
  }

  for (const name of names.sort()) {
    const full = path.join(root, name);
    if (name.endsWith(".md")) {
      const id = name.slice(0, -3);
      if (!isValidKnowledgeId(id)) continue;
      try {
        const raw = await readFile(full, "utf8");
        entries.push(parseKnowledgeFile(id, raw));
      } catch {
        // Skip unreadable entries rather than failing the whole list.
      }
      continue;
    }
    if (!isValidCollectionId(name)) continue;
    try {
      const st = await stat(full);
      if (st.isDirectory()) await scanRootEntries(full, name);
    } catch {
      // Skip unreadable entries rather than failing the whole list.
    }
  }
  return entries;
}

export async function readKnowledgeEntry(id: string, collection?: string): Promise<KnowledgeEntry | null> {
  if (!isValidKnowledgeId(id)) return null;
  if (collection !== undefined && !isValidCollectionId(collection)) return null;
  try {
    const raw = await readFile(entryPath(id, collection), "utf8");
    return parseKnowledgeFile(id, raw, collection);
  } catch {
    return null;
  }
}

export async function writeKnowledgeEntry(entry: KnowledgeEntry): Promise<KnowledgeEntry> {
  if (!isValidKnowledgeId(entry.id)) throw new Error("invalid knowledge id");
  if (entry.collection !== undefined && !isValidCollectionId(entry.collection)) {
    throw new Error("invalid knowledge collection");
  }
  const root = covenKnowledgeRoot();
  await mkdir(entry.collection ? collectionPath(entry.collection) : root, { recursive: true });
  await writeFile(entryPath(entry.id, entry.collection), serializeKnowledgeEntry(entry), "utf8");
  return entry;
}

export async function deleteKnowledgeEntry(id: string, collection?: string): Promise<boolean> {
  if (!isValidKnowledgeId(id)) return false;
  if (collection !== undefined && !isValidCollectionId(collection)) return false;
  try {
    await stat(entryPath(id, collection));
  } catch {
    return false;
  }
  await rm(entryPath(id, collection), { force: true });
  return true;
}

export async function readCollectionMeta(collection: string): Promise<KnowledgeCollectionMeta | null> {
  if (!isValidCollectionId(collection)) return null;
  try {
    const raw = await readFile(collectionMetaPath(collection), "utf8");
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const meta = parsed as Record<string, unknown>;
    if (typeof meta.name !== "string" || !meta.name.trim()) return null;
    // collection.yml is hand-editable YAML, so every optional field is coerced
    // at this single chokepoint: a stray `summary: 2026` (YAML number) must
    // degrade to "field absent", not throw `.trim is not a function` in the
    // prompt builder on every chat send.
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v : undefined;
    const fields = Array.isArray(meta.fields)
      ? meta.fields.filter(
          (f): f is { key: string; label: string } =>
            isPlainRecord(f) && typeof f.key === "string" && typeof f.label === "string",
        )
      : undefined;
    const pack =
      isPlainRecord(meta.pack) && typeof meta.pack.id === "string" && typeof meta.pack.version === "string"
        ? { id: meta.pack.id, version: meta.pack.version }
        : undefined;
    return {
      name: meta.name,
      ...(str(meta.description) ? { description: str(meta.description) } : {}),
      ...(str(meta.entityType) ? { entityType: str(meta.entityType) } : {}),
      ...(str(meta.storyQuestion) ? { storyQuestion: str(meta.storyQuestion) } : {}),
      ...(fields ? { fields } : {}),
      ...(pack ? { pack } : {}),
      ...(str(meta.summary) ? { summary: str(meta.summary) } : {}),
    };
  } catch {
    return null;
  }
}

export async function collectionMetaExists(collection: string): Promise<boolean> {
  if (!isValidCollectionId(collection)) return false;
  try {
    await stat(collectionMetaPath(collection));
    return true;
  } catch {
    return false;
  }
}

export async function writeCollectionMeta(collection: string, meta: KnowledgeCollectionMeta): Promise<void> {
  if (!isValidCollectionId(collection)) throw new Error("invalid knowledge collection");
  await mkdir(collectionPath(collection), { recursive: true });
  await writeFile(collectionMetaPath(collection), stringifyYaml(meta), "utf8");
}

/** Count valid `*.md` entry files in a collection directory without reading
 *  (or parsing) their contents — listCollections runs on every chat send. */
async function countCollectionEntries(collection: string): Promise<number> {
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await readdir(collectionPath(collection), { withFileTypes: true });
  } catch {
    return 0;
  }
  return dirents.filter((dirent) => {
    const name = dirent.name;
    if (name === "collection.yml" || !name.endsWith(".md")) return false;
    if (!dirent.isFile()) return false;
    return isValidKnowledgeId(name.slice(0, -3));
  }).length;
}

export async function listCollections(): Promise<{ id: string; meta: KnowledgeCollectionMeta | null; count: number }[]> {
  const root = covenKnowledgeRoot();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const collections: { id: string; meta: KnowledgeCollectionMeta | null; count: number }[] = [];
  for (const name of names.sort()) {
    if (!isValidCollectionId(name)) continue;
    try {
      const full = path.join(root, name);
      const st = await stat(full);
      if (!st.isDirectory()) continue;
      collections.push({
        id: name,
        meta: await readCollectionMeta(name),
        count: await countCollectionEntries(name),
      });
    } catch {
      // Skip unreadable collection directories.
    }
  }
  return collections;
}

/** Convenience for the prompt-construction layer: load the vault and select the
 *  entries that apply to this familiar. Never throws. */
export async function readKnowledgeVaultForPrompt(familiarId?: string): Promise<KnowledgeEntry[]> {
  try {
    const entries = await listKnowledgeEntries();
    return selectKnowledgeForFamiliar(entries, familiarId);
  } catch {
    return [];
  }
}
