import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";

export const RESEARCH_LEXICAL_SCHEMA_VERSION = 1;
export const RESEARCH_LEXICAL_CHUNKER_VERSION = "utf8-fixed-16384-v1";
export const RESEARCH_LEXICAL_CHUNK_BYTES = 16 * 1024;
export const MAX_RESEARCH_LEXICAL_BYTES = 64 * 1024 * 1024;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WINDOWS_DEVICE_IDS = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_TABLES = new Set(["chunks", "chunks_fts", "publications"]);
const REQUIRED_TRIGGERS = new Set(["chunks_ad", "chunks_ai"]);

export type ResearchLexicalAuthority = {
  resourceId: string;
  resourceRevision: number;
  deletionRevision: number;
  snapshotId: string;
  snapshotDigest: string;
};

export type ResearchLexicalChunk = {
  id: string;
  ordinal: number;
  byteStart: number;
  byteEnd: number;
  text: string;
};

export type ResearchLexicalProbeHit = ResearchLexicalChunk & { rank: number };

export type ResearchLexicalProbe = {
  usable: boolean;
  chunkCount: number;
  hits: ResearchLexicalProbeHit[];
};

export type ResearchResourceLexicalIndex = {
  readonly file: string;
  replace(input: ResearchLexicalAuthority & { normalizedBytes: Uint8Array }): ResearchLexicalChunk[];
  remove(authority: ResearchLexicalAuthority): boolean;
  publication(resourceId: string): ResearchLexicalAuthority | null;
  probe(authority: ResearchLexicalAuthority, query: string, limit?: number): ResearchLexicalProbe;
  purgeResidualFiles(): void;
  close(): void;
};

export class ResearchResourceLexicalIndexError extends Error {
  readonly code: "corrupt" | "invalid-input" | "unsafe-path";

  constructor(code: ResearchResourceLexicalIndexError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchResourceLexicalIndexError";
    this.code = code;
  }
}

type Statement = {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): unknown;
};

type Database = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

const SCHEMA = `
CREATE TABLE publications (
  resource_id TEXT PRIMARY KEY,
  resource_revision INTEGER NOT NULL,
  deletion_revision INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL,
  lexical_schema_version INTEGER NOT NULL,
  chunker_version TEXT NOT NULL
);
CREATE TABLE chunks (
  row_id INTEGER PRIMARY KEY,
  chunk_id TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL REFERENCES publications(resource_id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  byte_start INTEGER NOT NULL,
  byte_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(resource_id, ordinal)
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='row_id',
  tokenize='unicode61'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.row_id, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.row_id, old.text);
END;
PRAGMA user_version = ${RESEARCH_LEXICAL_SCHEMA_VERSION};
`;

function failInput(message: string): never {
  throw new ResearchResourceLexicalIndexError("invalid-input", message);
}

function assertId(value: string, label: string): void {
  if (!SAFE_ID.test(value) || WINDOWS_DEVICE_IDS.test(value)) failInput(`${label} is invalid`);
}

function assertAuthority(value: ResearchLexicalAuthority): void {
  assertId(value.resourceId, "resource id");
  assertId(value.snapshotId, "snapshot id");
  if (!Number.isSafeInteger(value.resourceRevision) || value.resourceRevision < 1) {
    failInput("resource revision is invalid");
  }
  if (!Number.isSafeInteger(value.deletionRevision) || value.deletionRevision < 0) {
    failInput("deletion revision is invalid");
  }
  if (!SHA256.test(value.snapshotDigest)) failInput("snapshot digest is invalid");
}

function sameAuthority(left: ResearchLexicalAuthority, right: ResearchLexicalAuthority): boolean {
  return left.resourceId === right.resourceId
    && left.resourceRevision === right.resourceRevision
    && left.deletionRevision === right.deletionRevision
    && left.snapshotId === right.snapshotId
    && left.snapshotDigest === right.snapshotDigest;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function chunkResearchResourceUtf8(
  normalizedBytes: Uint8Array,
  authority: ResearchLexicalAuthority,
  maximumChunkBytes = RESEARCH_LEXICAL_CHUNK_BYTES,
): ResearchLexicalChunk[] {
  assertAuthority(authority);
  const bytes = new Uint8Array(normalizedBytes);
  if (bytes.byteLength > MAX_RESEARCH_LEXICAL_BYTES) failInput("normalized text exceeds 64 MiB");
  if (!Number.isSafeInteger(maximumChunkBytes) || maximumChunkBytes < 4) {
    failInput("maximum chunk bytes must be a safe integer of at least four");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ResearchResourceLexicalIndexError("invalid-input", "normalized text is not valid UTF-8", {
      cause: error,
    });
  }

  const chunks: ResearchLexicalChunk[] = [];
  for (let start = 0, ordinal = 0; start < bytes.byteLength; ordinal += 1) {
    let end = Math.min(start + maximumChunkBytes, bytes.byteLength);
    while (end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end <= start) failInput("UTF-8 chunk boundary did not advance");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end));
    const id = sha256([
      authority.resourceId,
      String(authority.resourceRevision),
      String(authority.deletionRevision),
      authority.snapshotId,
      authority.snapshotDigest,
      String(start),
      String(end),
    ].join("\0"));
    chunks.push({ id, ordinal, byteStart: start, byteEnd: end, text });
    start = end;
  }
  return chunks;
}

function lexicalIndexPath(): string {
  return path.join(caveHome(), "research-resources", "index", "research-resources.sqlite");
}

function assertOwner(metadata: { uid?: number }, label: string): void {
  if (process.platform === "win32" || typeof process.getuid !== "function") return;
  if (metadata.uid !== process.getuid()) {
    throw new ResearchResourceLexicalIndexError("unsafe-path", `${label} is not owned by the current user`);
  }
}

function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ResearchResourceLexicalIndexError("unsafe-path", "lexical index directory is unsafe");
  }
  assertOwner(metadata, "lexical index directory");
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== DIRECTORY_MODE) {
    throw new ResearchResourceLexicalIndexError("unsafe-path", "lexical index directory must be private");
  }
}

function ensurePrivateFile(file: string): boolean {
  if (!existsSync(file)) {
    const descriptor = openSync(file, "wx", FILE_MODE);
    closeSync(descriptor);
    return true;
  }
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new ResearchResourceLexicalIndexError("unsafe-path", "lexical index file is unsafe");
  }
  assertOwner(metadata, "lexical index file");
  if (process.platform !== "win32" && (metadata.mode & 0o777) !== FILE_MODE) {
    throw new ResearchResourceLexicalIndexError("unsafe-path", "lexical index file must be private");
  }
  return false;
}

function hardenSqliteFiles(file: string): void {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    if (!existsSync(candidate)) continue;
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ResearchResourceLexicalIndexError("unsafe-path", "lexical SQLite sidecar is unsafe");
    }
    assertOwner(metadata, "lexical SQLite sidecar");
    if (process.platform !== "win32" && (metadata.mode & 0o777) !== FILE_MODE) {
      chmodSync(candidate, FILE_MODE);
    }
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function purgeResidualFiles(file: string): void {
  const directory = path.dirname(file);
  const base = escapeRegExp(path.basename(file));
  const quarantine = new RegExp(`^${base}\\.corrupt-[0-9]+-[a-f0-9]{8}(?:-wal|-shm)?$`);
  const interruptedRebuild = /^\.research-lexical-[0-9]+-[a-f0-9]{24}\.sqlite(?:-wal|-shm)?$/;
  let removed = false;
  for (const name of readdirSync(directory).sort()) {
    if (!quarantine.test(name) && !interruptedRebuild.test(name)) continue;
    const candidate = path.join(directory, name);
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new ResearchResourceLexicalIndexError(
        "unsafe-path",
        "lexical residual file is unsafe",
      );
    }
    assertOwner(metadata, "lexical residual file");
    rmSync(candidate);
    removed = true;
  }
  if (removed) syncDirectory(directory);
}

function publicationFromRow(row: Record<string, unknown> | undefined): ResearchLexicalAuthority | null {
  if (!row) return null;
  if (Number(row.lexical_schema_version) !== RESEARCH_LEXICAL_SCHEMA_VERSION
    || String(row.chunker_version) !== RESEARCH_LEXICAL_CHUNKER_VERSION) return null;
  return {
    resourceId: String(row.resource_id),
    resourceRevision: Number(row.resource_revision),
    deletionRevision: Number(row.deletion_revision),
    snapshotId: String(row.snapshot_id),
    snapshotDigest: String(row.snapshot_digest),
  };
}

function validateDatabase(database: Database, fresh: boolean): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA secure_delete = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (fresh) database.exec(SCHEMA);
  const version = Number(
    Object.values(database.prepare("PRAGMA user_version").get() ?? {})[0] ?? -1,
  );
  if (version !== RESEARCH_LEXICAL_SCHEMA_VERSION) throw new Error("unsupported lexical schema");
  const quickCheck = database.prepare("PRAGMA quick_check").all();
  if (quickCheck.length !== 1 || Object.values(quickCheck[0])[0] !== "ok") {
    throw new Error("lexical database failed quick_check");
  }
  const names = new Set(
    database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
      .all()
      .map((row) => String(row.name)),
  );
  for (const required of REQUIRED_TABLES) {
    if (!names.has(required)) throw new Error(`lexical database is missing ${required}`);
  }
  const triggers = new Set(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all()
      .map((row) => String(row.name)),
  );
  for (const required of REQUIRED_TRIGGERS) {
    if (!triggers.has(required)) throw new Error(`lexical database is missing ${required}`);
  }
  database.exec("INSERT INTO chunks_fts(chunks_fts, rank) VALUES('integrity-check', 1)");
}

function compactDeletedContent(database: Database): void {
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  database.exec("VACUUM");
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

async function loadSqlite(): Promise<{ DatabaseSync: new (file: string) => Database }> {
  return (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (file: string) => Database;
  };
}

function quotedFtsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function openAt(file: string): Promise<ResearchResourceLexicalIndex> {
  if (!path.isAbsolute(file)) {
    throw new ResearchResourceLexicalIndexError("unsafe-path", "lexical index path must be absolute");
  }
  ensureDirectory(path.dirname(file));
  const fresh = ensurePrivateFile(file);
  hardenSqliteFiles(file);
  const { DatabaseSync } = await loadSqlite();
  let database: Database | null = null;
  try {
    database = new DatabaseSync(file);
    validateDatabase(database, fresh);
    hardenSqliteFiles(file);
  } catch (error) {
    database?.close();
    hardenSqliteFiles(file);
    throw new ResearchResourceLexicalIndexError("corrupt", "Research lexical index requires rebuild", {
      cause: error,
    });
  }

  const currentPublication = (resourceId: string): ResearchLexicalAuthority | null => {
    assertId(resourceId, "resource id");
    return publicationFromRow(database!.prepare(
      `SELECT resource_id, resource_revision, deletion_revision, snapshot_id, snapshot_digest,
              lexical_schema_version, chunker_version
       FROM publications WHERE resource_id = ?`,
    ).get(resourceId));
  };

  return {
    file,
    replace(input) {
      assertAuthority(input);
      const chunks = chunkResearchResourceUtf8(input.normalizedBytes, input);
      database!.exec("BEGIN IMMEDIATE");
      try {
        database!.prepare("DELETE FROM chunks WHERE resource_id = ?").run(input.resourceId);
        database!.prepare(
          `INSERT INTO publications (
             resource_id, resource_revision, deletion_revision, snapshot_id, snapshot_digest,
             lexical_schema_version, chunker_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(resource_id) DO UPDATE SET
             resource_revision=excluded.resource_revision,
             deletion_revision=excluded.deletion_revision,
             snapshot_id=excluded.snapshot_id,
             snapshot_digest=excluded.snapshot_digest,
             lexical_schema_version=excluded.lexical_schema_version,
             chunker_version=excluded.chunker_version`,
        ).run(
          input.resourceId,
          input.resourceRevision,
          input.deletionRevision,
          input.snapshotId,
          input.snapshotDigest,
          RESEARCH_LEXICAL_SCHEMA_VERSION,
          RESEARCH_LEXICAL_CHUNKER_VERSION,
        );
        const insert = database!.prepare(
          `INSERT INTO chunks (
             chunk_id, resource_id, snapshot_id, ordinal, byte_start, byte_end, text
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const chunk of chunks) {
          insert.run(
            chunk.id,
            input.resourceId,
            input.snapshotId,
            chunk.ordinal,
            chunk.byteStart,
            chunk.byteEnd,
            chunk.text,
          );
        }
        database!.exec("COMMIT");
        hardenSqliteFiles(file);
        return chunks.map((chunk) => ({ ...chunk }));
      } catch (error) {
        try { database!.exec("ROLLBACK"); } catch { /* original error wins */ }
        throw error;
      }
    },

    remove(authority) {
      assertAuthority(authority);
      database!.exec("BEGIN IMMEDIATE");
      try {
        const current = currentPublication(authority.resourceId);
        if (!current || !sameAuthority(current, authority)) {
          database!.exec("ROLLBACK");
          return false;
        }
        database!.prepare("DELETE FROM chunks WHERE resource_id = ?").run(authority.resourceId);
        database!.prepare("DELETE FROM publications WHERE resource_id = ?").run(authority.resourceId);
        database!.exec("COMMIT");
        hardenSqliteFiles(file);
        return true;
      } catch (error) {
        try { database!.exec("ROLLBACK"); } catch { /* original error wins */ }
        throw error;
      }
    },

    publication: currentPublication,

    probe(authority, query, limit = 20) {
      assertAuthority(authority);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) failInput("probe limit is invalid");
      const current = currentPublication(authority.resourceId);
      if (!current || !sameAuthority(current, authority)) {
        return { usable: false, chunkCount: 0, hits: [] };
      }
      const count = Number(database!.prepare(
        "SELECT COUNT(*) AS count FROM chunks WHERE resource_id = ? AND snapshot_id = ?",
      ).get(authority.resourceId, authority.snapshotId)?.count ?? 0);
      const trimmed = query.trim();
      if (!trimmed) return { usable: true, chunkCount: count, hits: [] };
      const rows = database!.prepare(
        `SELECT c.chunk_id, c.ordinal, c.byte_start, c.byte_end, c.text,
                bm25(chunks_fts) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.row_id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND c.resource_id = ? AND c.snapshot_id = ?
         ORDER BY rank ASC, c.ordinal ASC
         LIMIT ?`,
      ).all(quotedFtsPhrase(trimmed), authority.resourceId, authority.snapshotId, limit);
      return {
        usable: true,
        chunkCount: count,
        hits: rows.map((row) => ({
          id: String(row.chunk_id),
          ordinal: Number(row.ordinal),
          byteStart: Number(row.byte_start),
          byteEnd: Number(row.byte_end),
          text: String(row.text),
          rank: Number(row.rank),
        })),
      };
    },

    purgeResidualFiles() {
      compactDeletedContent(database!);
      hardenSqliteFiles(file);
      purgeResidualFiles(file);
    },

    close() {
      if (!database) return;
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      database.close();
      database = null;
      hardenSqliteFiles(file);
    },
  };
}

export async function openResearchResourceLexicalIndex(
  options: { file?: string } = {},
): Promise<ResearchResourceLexicalIndex> {
  return openAt(path.resolve(options.file ?? lexicalIndexPath()));
}

export async function rebuildResearchResourceLexicalIndex(
  options: { file?: string },
  populateFromVerifiedSnapshots: (index: ResearchResourceLexicalIndex) => void | Promise<void>,
): Promise<{ index: ResearchResourceLexicalIndex; quarantinePath: string | null }> {
  const file = path.resolve(options.file ?? lexicalIndexPath());
  ensureDirectory(path.dirname(file));
  const temporary = path.join(
    path.dirname(file),
    `.research-lexical-${process.pid}-${randomBytes(12).toString("hex")}.sqlite`,
  );
  let candidate: ResearchResourceLexicalIndex | null = null;
  try {
    candidate = await openAt(temporary);
    await populateFromVerifiedSnapshots(candidate);
    candidate.close();
    candidate = await openAt(temporary);
    candidate.close();
    candidate = null;
    syncDirectory(path.dirname(file));
  } catch (error) {
    try { candidate?.close(); } catch { /* reconstruction error wins */ }
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${temporary}${suffix}`, { force: true });
    syncDirectory(path.dirname(file));
    throw error;
  }

  const quarantinePath = existsSync(file)
    ? `${file}.corrupt-${Date.now()}-${randomBytes(4).toString("hex")}`
    : null;
  if (quarantinePath) {
    renameSync(file, quarantinePath);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${file}${suffix}`)) renameSync(`${file}${suffix}`, `${quarantinePath}${suffix}`);
    }
    syncDirectory(path.dirname(file));
  }
  try {
    renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } catch (error) {
    if (quarantinePath && !existsSync(file)) {
      renameSync(quarantinePath, file);
      syncDirectory(path.dirname(file));
    }
    throw error;
  }
  hardenSqliteFiles(file);
  const index = await openAt(file);
  return { index, quarantinePath };
}
