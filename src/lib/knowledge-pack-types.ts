/**
 * Knowledge Packs — shared, client-safe types.
 *
 * A knowledge pack is a marketplace-distributed bundle (kind "knowledge-pack")
 * that seeds a linked knowledge base: folders with entity schemas, entry
 * templates, a bundled agent skill, cadence prompts, and audit workflows.
 * Mirrors OpenKnowledge's starter packs (e.g. worldbuilding).
 *
 * Source of truth: `marketplace/catalog.json` (`knowledgePack` block, schema
 * `opencoven.knowledge-pack.v1`). `scripts/sync-marketplace.py` compiles it to
 * `marketplace/plugins/<pack>/pack.json` (this manifest shape) plus
 * `templates/*.md` and `skills/<id>/**` beside it. The seed engine
 * (`src/lib/server/knowledge-packs.ts`) consumes the compiled manifest.
 *
 * Client-safe: types + pure guards only — no node imports.
 */

export const KNOWLEDGE_PACK_SCHEMA_VERSION = "opencoven.knowledge-pack.v1";

/** One frontmatter field an entity type carries (e.g. `faction`, `status`). */
export type KnowledgePackFolderField = {
  /** Frontmatter key, slug-like (e.g. "faction", "dangerLevel"). */
  key: string;
  label: string;
  description?: string;
  /** Suggested values shown to authors/agents (e.g. status: alive | dead). */
  options?: string[];
};

/** A seeded folder — one entity type ("characters" answers *Who*). */
export type KnowledgePackFolder = {
  /** Slug; becomes the folder / vault-collection name. */
  id: string;
  name: string;
  description: string;
  /** The story question the folder answers ("Who", "Where", "Why"…). */
  storyQuestion?: string;
  /** Frontmatter `type:` value stamped on entries (e.g. "character"). */
  entityType: string;
  fields: KnowledgePackFolderField[];
  /** Template ids (from `templates`) that belong to this folder. */
  templates: string[];
};

/** Compiled template metadata; body lives in `templates/<id>.md`. */
export type KnowledgePackTemplateMeta = {
  id: string;
  /** Owning folder id. */
  folder: string;
  name: string;
  description?: string;
  /** Path relative to the generated plugin dir, e.g. "templates/character.md". */
  path: string;
};

/** Compiled pack manifest — `marketplace/plugins/<pack>/pack.json`. */
export type KnowledgePackManifest = {
  schemaVersion: typeof KNOWLEDGE_PACK_SCHEMA_VERSION;
  id: string;
  displayName: string;
  description: string;
  version: string;
  /** Suggested project subfolder to nest under (e.g. "world"). */
  defaultRoot?: string;
  folders: KnowledgePackFolder[];
  templates: KnowledgePackTemplateMeta[];
  /** Bundled skill ids — dirs under the plugin's `skills/`. */
  skills: string[];
  /** Bundled prompt-template ids (standard prompt-pack files). */
  prompts: string[];
  /** Workflow ids expected under repo `workflows/<id>.yaml`. */
  workflows: string[];
};

/** `collection.yml` metadata stored beside vault-collection entries — the
 *  `.ok/frontmatter.yml` analogue. Never injected wholesale into prompts. */
export type KnowledgeCollectionMeta = {
  name: string;
  description?: string;
  entityType?: string;
  storyQuestion?: string;
  fields?: KnowledgePackFolderField[];
  /** Pack provenance when seeded from a knowledge pack. */
  pack?: { id: string; version: string };
  /** One-line index summary that MAY be injected into prompts cheaply. */
  summary?: string;
};

/** Seed targets: the shared vault, or a registered project's folder tree. */
export type KnowledgePackSeedTarget =
  | { target: "vault" }
  | { target: "project"; projectRoot: string; subfolder?: string };

export type KnowledgePackSeedRequest = { packId: string } & KnowledgePackSeedTarget;

export type KnowledgePackSeedResult = {
  ok: true;
  target: "vault" | "project";
  /** Absolute paths (project) or `collection/id` slugs (vault) created. */
  created: string[];
  /** Entries that already existed and were left untouched. */
  skipped: string[];
  /** Vault target only: the collection ids seeded. */
  collections?: string[];
};

const PACK_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Slug guard shared by pack ids, folder ids, and template ids — these become
 *  path segments, so they must never contain separators or dots. */
export function isValidPackSlug(value: unknown): value is string {
  return typeof value === "string" && PACK_SLUG_RE.test(value);
}
