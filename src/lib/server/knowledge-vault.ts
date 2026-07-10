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
import { parse as parseYaml } from "yaml";
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
  title: string;
  tags: string[];
  /** "global" → every familiar; otherwise an explicit familiar-id allow-list. */
  scope: KnowledgeScope;
  enabled: boolean;
  body: string;
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

/** Parse one entry file's contents (frontmatter + body) into an entry. */
export function parseKnowledgeFile(id: string, raw: string): KnowledgeEntry {
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
  return {
    id,
    title: typeof front.title === "string" && front.title.trim() ? front.title.trim() : id,
    tags: normalizeTags(front.tags),
    scope: normalizeScope(front.scope),
    enabled: front.enabled !== false,
    body: body.trim(),
    ...(pins.length > 0 ? { pins } : {}),
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
): string {
  const text = prompt.trim();
  const usable = entries.filter((e) => e.enabled && e.body.trim());
  if (usable.length === 0) return text;

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
    ...blocks,
    "</KNOWLEDGE_VAULT>",
  ].join("\n\n");

  return text ? `${context}\n\n${text}` : context;
}

// ── Filesystem store ─────────────────────────────────────────────────────────

function entryPath(id: string): string {
  // Single chokepoint where a vault path is built from the (slug-validated) id.
  // Resolve and assert containment directly under the vault root so a path can
  // never escape it, even if a caller forgets the id guard.
  const root = path.resolve(covenKnowledgeRoot());
  const resolved = path.resolve(root, `${id}.md`);
  if (!resolved.startsWith(root + path.sep) || path.dirname(resolved) !== root) {
    throw new Error("invalid knowledge id");
  }
  return resolved;
}

/** List every vault entry on disk. Returns [] when the directory is absent or
 *  unreadable — the vault is an optional add-on, never a hard dependency. */
export async function listKnowledgeEntries(): Promise<KnowledgeEntry[]> {
  const root = covenKnowledgeRoot();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const entries: KnowledgeEntry[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3);
    if (!isValidKnowledgeId(id)) continue;
    try {
      const raw = await readFile(path.join(root, name), "utf8");
      entries.push(parseKnowledgeFile(id, raw));
    } catch {
      // Skip unreadable entries rather than failing the whole list.
    }
  }
  return entries;
}

export async function readKnowledgeEntry(id: string): Promise<KnowledgeEntry | null> {
  if (!isValidKnowledgeId(id)) return null;
  try {
    const raw = await readFile(entryPath(id), "utf8");
    return parseKnowledgeFile(id, raw);
  } catch {
    return null;
  }
}

export async function writeKnowledgeEntry(entry: KnowledgeEntry): Promise<KnowledgeEntry> {
  if (!isValidKnowledgeId(entry.id)) throw new Error("invalid knowledge id");
  const root = covenKnowledgeRoot();
  await mkdir(root, { recursive: true });
  await writeFile(entryPath(entry.id), serializeKnowledgeEntry(entry), "utf8");
  return entry;
}

export async function deleteKnowledgeEntry(id: string): Promise<boolean> {
  if (!isValidKnowledgeId(id)) return false;
  try {
    await stat(entryPath(id));
  } catch {
    return false;
  }
  await rm(entryPath(id), { force: true });
  return true;
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
