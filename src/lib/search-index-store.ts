/**
 * search-index-store — the derivative SQLite/FTS5 index behind global search
 * (cave-ychtl.2).
 *
 * The index is ALWAYS derivative. Every row can be rebuilt from an
 * authoritative source, which is what makes the aggressive failure handling
 * here safe: a corrupt database is quarantined and recreated rather than
 * repaired, and a failed refresh discards its own partial work instead of
 * half-updating a provider. Nothing unique lives in this file, so losing it
 * costs a rescan and nothing else.
 *
 * FTS5 availability was verified before this was planned — `node:sqlite` ships
 * it with no third-party dependency (SQLite 3.53.1). `node:sqlite` is still
 * experimental, so it is imported lazily, following the pattern already used in
 * src/lib/threads-adapters.ts.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

import {
  chmodSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import {
  normalizeSearchDocument,
  searchDocumentKey,
  type SearchDocument,
} from "./search-document.ts";

/** Bump only alongside a migration in {@link migrate}. */
export const SEARCH_INDEX_SCHEMA_VERSION = 1;

const DB_BASENAME = "search-index.sqlite";

/**
 * Where the derivative index lives: under Cave's local state, beside nothing
 * authoritative, and deliberately NOT inside the daemon database.
 *
 * Exported so anything that builds a backup or export payload has one place to
 * consult in order to leave it out. No exporter exists today, so this is the
 * hook rather than an enforced exclusion — stated plainly instead of implied.
 */
export function searchIndexPath(): string {
  return process.env.COVEN_CAVE_SEARCH_INDEX ?? path.join(caveHome(), DB_BASENAME);
}

export type ProviderIndexState = {
  providerId: string;
  /** Last fingerprint a refresh COMPLETED with. */
  fingerprint: string | null;
  /** True when the last refresh failed, so rows are last-known-good. */
  stale: boolean;
  documentCount: number;
  updatedAt: string | null;
};

export type RefreshOutcome = {
  providerId: string;
  /** No work done because the fingerprint matched. */
  skipped: boolean;
  upserted: number;
  removed: number;
  stale: boolean;
  error?: string;
};

export type SearchIndexQuery = {
  /** Free text, matched across title, body and tags. */
  text?: string;
  /** Exact phrases, all of which must be present. */
  phrases?: string[];
  entityTypes?: string[];
  projectIds?: string[];
  familiarIds?: string[];
  statuses?: string[];
  providerIds?: string[];
  limit?: number;
};

export type SearchIndexRow = {
  document: SearchDocument;
  relevance: number;
  stale: boolean;
};

export type SearchIndex = {
  readonly file: string;
  refreshProvider(
    providerId: string,
    fingerprint: string,
    collect: () => Iterable<unknown>,
  ): RefreshOutcome;
  providerState(providerId: string): ProviderIndexState | null;
  match(query: SearchIndexQuery): SearchIndexRow[];
  documentCount(): number;
  /** Drop everything and recreate the schema. The index is derivative. */
  rebuild(): void;
  close(): void;
};

type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
  close(): void;
};

/**
 * Lazy import so the experimental-module warning is paid only by callers that
 * actually open an index — importing this module must stay free. Same pattern
 * as src/lib/threads-adapters.ts.
 */
async function loadSqlite(): Promise<{ DatabaseSync: new (file: string) => DatabaseHandle }> {
  return (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (file: string) => DatabaseHandle;
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  provider_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  project_id TEXT,
  project_root TEXT,
  familiar_id TEXT,
  room_id TEXT,
  session_id TEXT,
  runtime TEXT,
  status TEXT,
  tags TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  source_type TEXT NOT NULL,
  permissions TEXT NOT NULL,
  source_version TEXT NOT NULL,
  action TEXT NOT NULL,
  secondary_actions TEXT NOT NULL,
  PRIMARY KEY (provider_id, doc_id)
);
CREATE INDEX IF NOT EXISTS documents_entity ON documents(entity_type);
CREATE INDEX IF NOT EXISTS documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS documents_familiar ON documents(familiar_id);
CREATE INDEX IF NOT EXISTS documents_status ON documents(status);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  body,
  tags,
  provider_id UNINDEXED,
  doc_id UNINDEXED
);
CREATE TABLE IF NOT EXISTS provider_state (
  provider_id TEXT PRIMARY KEY,
  fingerprint TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
`;

function ensureNotSymlink(file: string): void {
  // A symlinked database is a redirection of where we write; refuse rather than
  // follow it. Checked with lstat so the link itself is inspected.
  let entry;
  try {
    entry = lstatSync(/* turbopackIgnore: true */ file);
  } catch {
    return; // absent is fine — it will be created
  }
  if (entry.isSymbolicLink()) {
    throw new Error("search index path must not be a symlink");
  }
}

function quarantine(file: string): void {
  // Keep the damaged file next to the new one rather than deleting it: it costs
  // nothing to retain, and a corrupt index is evidence about whatever produced
  // it. The name is stable so repeated corruption overwrites one artifact
  // instead of growing a pile.
  try {
    renameSync(/* turbopackIgnore: true */ file, `${file}.corrupt`);
  } catch {
    try {
      rmSync(/* turbopackIgnore: true */ file, { force: true });
    } catch {
      /* the open below will surface anything still wrong */
    }
  }
}

function applyFilePermissions(file: string): void {
  try {
    const entry = statSync(/* turbopackIgnore: true */ file);
    if ((entry.mode & 0o777) !== 0o600) {
      chmodSync(/* turbopackIgnore: true */ file, 0o600);
    }
  } catch {
    /* a freshly created database may not be flushed yet; retried next open */
  }
}

function migrate(database: DatabaseHandle): void {
  database.exec(SCHEMA);
  const row = database
    .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
    .get() as { value?: string } | undefined;
  const current = Number(row?.value ?? 0);
  if (current === SEARCH_INDEX_SCHEMA_VERSION) return;
  if (current > SEARCH_INDEX_SCHEMA_VERSION) {
    // A newer Cave wrote this. Refuse to reinterpret it — the index is
    // derivative, so discarding and rebuilding is cheaper than guessing.
    throw new Error("search index schema is newer than this build");
  }
  database
    .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)")
    .run(String(SEARCH_INDEX_SCHEMA_VERSION));
}

async function openDatabase(file: string): Promise<DatabaseHandle> {
  const { DatabaseSync } = await loadSqlite();
  mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  ensureNotSymlink(file);

  const open = () => {
    const database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    migrate(database);
    return database;
  };

  try {
    const database = open();
    applyFilePermissions(file);
    return database;
  } catch (error) {
    // Corrupt, truncated, or schema-incompatible. Quarantine and rebuild —
    // never repair, because every row is reproducible from its source.
    if (file === ":memory:") throw error;
    quarantine(file);
    const database = open();
    applyFilePermissions(file);
    return database;
  }
}

const toRow = (record: Record<string, unknown>): SearchDocument => {
  const parseJson = <T,>(value: unknown, fallback: T): T => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };
  return normalizeSearchDocument({
    id: record.doc_id,
    providerId: record.provider_id,
    entityType: record.entity_type,
    title: record.title,
    body: record.body,
    excerpt: record.excerpt,
    projectId: record.project_id,
    projectRoot: record.project_root,
    familiarId: record.familiar_id,
    roomId: record.room_id,
    sessionId: record.session_id,
    runtime: record.runtime,
    status: record.status,
    tags: parseJson(record.tags, [] as string[]),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    sourceType: record.source_type,
    permissions: parseJson(record.permissions, [] as SearchDocument["permissions"]),
    sourceVersion: record.source_version,
    action: parseJson(record.action, { id: "", label: "" }),
    secondaryActions: parseJson(record.secondary_actions, [] as SearchDocument["secondaryActions"]),
  })!;
};

/** Escape a term for an FTS5 MATCH expression by quoting it. */
function ftsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

function buildMatchExpression(query: SearchIndexQuery): string | null {
  const clauses: string[] = [];
  for (const phrase of query.phrases ?? []) {
    const trimmed = phrase.trim();
    if (trimmed.length > 0) clauses.push(ftsTerm(trimmed));
  }
  const words = (query.text ?? "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  for (const word of words) clauses.push(`${ftsTerm(word)}*`);
  return clauses.length > 0 ? clauses.join(" AND ") : null;
}

export async function openSearchIndex(
  file: string = searchIndexPath(),
): Promise<SearchIndex> {
  const database = await openDatabase(file);

  const readProviderState = (providerId: string): ProviderIndexState | null => {
    const row = database
      .prepare("SELECT fingerprint, stale, updated_at FROM provider_state WHERE provider_id = ?")
      .get(providerId) as
      | { fingerprint?: string | null; stale?: number; updated_at?: string | null }
      | undefined;
    if (!row) return null;
    const count = database
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE provider_id = ?")
      .get(providerId) as { n?: number } | undefined;
    return {
      providerId,
      fingerprint: row.fingerprint ?? null,
      stale: Boolean(row.stale),
      documentCount: Number(count?.n ?? 0),
      updatedAt: row.updated_at ?? null,
    };
  };

  return {
    get file() {
      return file;
    },

    refreshProvider(providerId, fingerprint, collect) {
      const previous = readProviderState(providerId);
      if (previous && !previous.stale && previous.fingerprint === fingerprint) {
        // The source has not moved. Skipping is the whole point of carrying a
        // fingerprint — a refresh that rescans an unchanged corpus is the cost
        // this design exists to avoid.
        return { providerId, skipped: true, upserted: 0, removed: 0, stale: false };
      }

      let upserted = 0;
      let removed = 0;
      database.exec("BEGIN IMMEDIATE");
      try {
        const seen = new Set<string>();
        const insertDocument = database.prepare(
          `INSERT INTO documents (
             provider_id, doc_id, entity_type, title, body, excerpt,
             project_id, project_root, familiar_id, room_id, session_id,
             runtime, status, tags, created_at, updated_at, source_type,
             permissions, source_version, action, secondary_actions
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(provider_id, doc_id) DO UPDATE SET
             entity_type=excluded.entity_type, title=excluded.title,
             body=excluded.body, excerpt=excluded.excerpt,
             project_id=excluded.project_id, project_root=excluded.project_root,
             familiar_id=excluded.familiar_id, room_id=excluded.room_id,
             session_id=excluded.session_id, runtime=excluded.runtime,
             status=excluded.status, tags=excluded.tags,
             created_at=excluded.created_at, updated_at=excluded.updated_at,
             source_type=excluded.source_type, permissions=excluded.permissions,
             source_version=excluded.source_version, action=excluded.action,
             secondary_actions=excluded.secondary_actions`,
        );
        const deleteFts = database.prepare(
          "DELETE FROM documents_fts WHERE provider_id = ? AND doc_id = ?",
        );
        const insertFts = database.prepare(
          "INSERT INTO documents_fts (title, body, tags, provider_id, doc_id) VALUES (?,?,?,?,?)",
        );
        const existingVersion = database.prepare(
          "SELECT source_version FROM documents WHERE provider_id = ? AND doc_id = ?",
        );

        for (const raw of collect()) {
          const document = normalizeSearchDocument(raw);
          // One malformed row loses its own fidelity; it does not abort the
          // refresh and leave every other document stale.
          if (!document || document.providerId !== providerId) continue;
          seen.add(searchDocumentKey(document));

          const prior = existingVersion.get(providerId, document.id) as
            | { source_version?: string }
            | undefined;
          if (prior && prior.source_version === document.sourceVersion && document.sourceVersion !== "") {
            continue; // unchanged row, per the provider's own fingerprint
          }

          insertDocument.run(
            document.providerId,
            document.id,
            document.entityType,
            document.title,
            document.body,
            document.excerpt,
            document.projectId,
            document.projectRoot,
            document.familiarId,
            document.roomId,
            document.sessionId,
            document.runtime,
            document.status,
            JSON.stringify(document.tags),
            document.createdAt,
            document.updatedAt,
            document.sourceType,
            JSON.stringify(document.permissions),
            document.sourceVersion,
            JSON.stringify(document.action),
            JSON.stringify(document.secondaryActions),
          );
          deleteFts.run(document.providerId, document.id);
          insertFts.run(
            document.title,
            document.body,
            document.tags.join(" "),
            document.providerId,
            document.id,
          );
          upserted += 1;
        }

        // Documents the source no longer produces must leave the index, or a
        // deleted task keeps answering searches forever.
        const present = database
          .prepare("SELECT doc_id FROM documents WHERE provider_id = ?")
          .all(providerId) as { doc_id: string }[];
        const deleteDocument = database.prepare(
          "DELETE FROM documents WHERE provider_id = ? AND doc_id = ?",
        );
        for (const row of present) {
          // Same key function as the insert side. Building it by hand here is
          // exactly how the two spellings drift and this loop starts deleting
          // rows the loop above just wrote.
          if (seen.has(searchDocumentKey({ providerId, id: row.doc_id }))) continue;
          deleteDocument.run(providerId, row.doc_id);
          deleteFts.run(providerId, row.doc_id);
          removed += 1;
        }

        database
          .prepare(
            `INSERT INTO provider_state (provider_id, fingerprint, stale, updated_at)
             VALUES (?, ?, 0, ?)
             ON CONFLICT(provider_id) DO UPDATE SET
               fingerprint=excluded.fingerprint, stale=0, updated_at=excluded.updated_at`,
          )
          .run(providerId, fingerprint, new Date().toISOString());
        database.exec("COMMIT");
        return { providerId, skipped: false, upserted, removed, stale: false };
      } catch (error) {
        database.exec("ROLLBACK");
        // The last verified snapshot survives untouched; it is simply flagged
        // so callers can say "these results may be out of date" rather than
        // presenting a half-written index as current.
        database
          .prepare(
            `INSERT INTO provider_state (provider_id, fingerprint, stale, updated_at)
             VALUES (?, NULL, 1, ?)
             ON CONFLICT(provider_id) DO UPDATE SET stale=1, updated_at=excluded.updated_at`,
          )
          .run(providerId, new Date().toISOString());
        return {
          providerId,
          skipped: false,
          upserted: 0,
          removed: 0,
          stale: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    providerState: readProviderState,

    match(query) {
      const expression = buildMatchExpression(query);
      const conditions: string[] = [];
      const params: unknown[] = [];

      const inClause = (column: string, values: string[] | undefined) => {
        if (!values || values.length === 0) return;
        conditions.push(`d.${column} IN (${values.map(() => "?").join(",")})`);
        params.push(...values);
      };

      let sql: string;
      if (expression) {
        sql = `SELECT d.*, bm25(documents_fts) AS relevance
               FROM documents_fts f
               JOIN documents d ON d.provider_id = f.provider_id AND d.doc_id = f.doc_id
               WHERE documents_fts MATCH ?`;
        params.push(expression);
      } else {
        sql = "SELECT d.*, 0 AS relevance FROM documents d WHERE 1=1";
      }

      inClause("entity_type", query.entityTypes);
      inClause("project_id", query.projectIds);
      inClause("familiar_id", query.familiarIds);
      inClause("status", query.statuses);
      inClause("provider_id", query.providerIds);
      if (conditions.length > 0) sql += ` AND ${conditions.join(" AND ")}`;
      sql += expression ? " ORDER BY relevance" : " ORDER BY d.updated_at DESC";
      sql += ` LIMIT ${Math.max(1, Math.min(query.limit ?? 50, 500))}`;

      const staleProviders = new Set(
        (database.prepare("SELECT provider_id FROM provider_state WHERE stale = 1").all() as {
          provider_id: string;
        }[]).map((row) => row.provider_id),
      );

      return (database.prepare(sql).all(...params) as Record<string, unknown>[]).map((record) => ({
        document: toRow(record),
        relevance: Number(record.relevance ?? 0),
        stale: staleProviders.has(String(record.provider_id)),
      }));
    },

    documentCount() {
      const row = database.prepare("SELECT COUNT(*) AS n FROM documents").get() as
        | { n?: number }
        | undefined;
      return Number(row?.n ?? 0);
    },

    rebuild() {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec("DELETE FROM documents");
        database.exec("DELETE FROM documents_fts");
        database.exec("DELETE FROM provider_state");
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    close() {
      database.close();
    },
  };
}
