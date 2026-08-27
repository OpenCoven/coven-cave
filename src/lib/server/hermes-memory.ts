import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import { redact } from "../redact.ts";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_EXCERPT_LENGTH = 280;
const MAX_CONTENT_LENGTH = 2_000_000;
const HERMES_URI_PREFIX = "hermes://familiar/";

type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

type HermesMessageRow = {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  timestamp: number;
  sessionTitle: string | null;
  source: string | null;
  cwd: string | null;
};

export type HermesProviderStatus = {
  id: string;
  tier: "built-in" | "external";
  readState: "ready" | "credential-required";
};

export type HermesMemoryStatus = {
  available: boolean;
  databasePath: string;
  provider: HermesProviderStatus;
  error?: "database-unavailable" | "database-unreadable";
};

export type HermesMemoryEntry = {
  root: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
  sourceId: "hermes-state";
  rootPath: string;
  rootLabel: string;
  sourceKind: "external-harness";
  sourceKindLabel: string;
  title: string;
  excerpt: string;
  harnessId: "hermes";
  runtimeId: "hermes";
  origin: "hermes-state";
  sourceContext: string;
  readOnly: true;
  contentKind: "hermes-message";
};

export type HermesMemoryListing = {
  entries: HermesMemoryEntry[];
  status: HermesMemoryStatus;
};

type HermesMemoryOptions = {
  hermesHome: string;
  familiarId: string;
  query?: string;
  limit?: number;
};

type HermesMessageContent = {
  path: string;
  content: string;
  size: number;
  modified: string;
  readOnly: true;
};

async function loadSqlite(): Promise<{
  DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => DatabaseHandle;
}> {
  return (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => DatabaseHandle;
  };
}

function stateDatabasePath(hermesHome: string): string {
  return path.join(hermesHome, "state.db");
}

async function configuredProvider(hermesHome: string): Promise<HermesProviderStatus> {
  const configPath = path.join(hermesHome, "config.yaml");
  if (!existsSync(configPath)) {
    return { id: "built-in", tier: "built-in", readState: "ready" };
  }

  try {
    const config = parseYaml(await readFile(configPath, "utf8")) as {
      memory?: { provider?: unknown };
    } | null;
    const provider =
      typeof config?.memory?.provider === "string"
        ? config.memory.provider.trim().toLowerCase()
        : "";
    if (!provider || provider === "builtin" || provider === "built-in") {
      return { id: "built-in", tier: "built-in", readState: "ready" };
    }
    return { id: provider, tier: "external", readState: "credential-required" };
  } catch {
    return { id: "built-in", tier: "built-in", readState: "ready" };
  }
}

function boundedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value).trim();
  return normalized || null;
}

function asFiniteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeRow(row: Record<string, unknown>): HermesMessageRow {
  return {
    id: asFiniteNumber(row.id),
    sessionId: asString(row.session_id),
    role: asString(row.role) || "message",
    content: asString(row.content),
    timestamp: asFiniteNumber(row.timestamp),
    sessionTitle: asNullableString(row.session_title),
    source: asNullableString(row.source),
    cwd: asNullableString(row.cwd),
  };
}

function timestampIso(timestamp: number): string {
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function messageTitle(row: HermesMessageRow): string {
  const role = row.role.charAt(0).toUpperCase() + row.role.slice(1);
  return row.sessionTitle ? `${row.sessionTitle} · ${role}` : `${role} message`;
}

function excerpt(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EXCERPT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function ftsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.replaceAll('"', "").trim())
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(" AND ");
}

function rowToEntry(
  row: HermesMessageRow,
  databasePath: string,
  familiarId: string,
): HermesMemoryEntry {
  const title = messageTitle(row);
  return {
    root: databasePath,
    relPath: title,
    fullPath: `${HERMES_URI_PREFIX}${encodeURIComponent(familiarId)}/messages/${row.id}`,
    size: Buffer.byteLength(row.content),
    modified: timestampIso(row.timestamp),
    sourceId: "hermes-state",
    rootPath: databasePath,
    rootLabel: "Hermes history",
    sourceKind: "external-harness",
    sourceKindLabel: "Hermes",
    title,
    excerpt: excerpt(redact(row.content).text),
    harnessId: "hermes",
    runtimeId: "hermes",
    origin: "hermes-state",
    sourceContext: databasePath,
    readOnly: true,
    contentKind: "hermes-message",
  };
}

function queryMessages(
  database: DatabaseHandle,
  query: string,
  limit: number,
): Record<string, unknown>[] {
  const select = `
    SELECT
      m.id,
      m.session_id,
      m.role,
      substr(COALESCE(m.content, ''), 1, 1000) AS content,
      m.timestamp,
      COALESCE(NULLIF(s.title, ''), NULLIF(s.display_name, '')) AS session_title,
      s.source,
      s.cwd
    FROM messages m
    LEFT JOIN sessions s ON s.id = m.session_id
  `;
  const active = "(m.active = 1 OR m.compacted = 1)";
  if (!query.trim()) {
    return database
      .prepare(`${select} WHERE ${active} ORDER BY m.timestamp DESC, m.id DESC LIMIT ?`)
      .all(limit);
  }

  const match = ftsQuery(query);
  if (!match) return [];
  return database
    .prepare(`
      ${select}
      JOIN messages_fts ON messages_fts.rowid = m.id
      WHERE ${active} AND messages_fts MATCH ?
      ORDER BY bm25(messages_fts), m.timestamp DESC
      LIMIT ?
    `)
    .all(match, limit);
}

export function parseHermesMemoryUri(
  uri: string,
): { familiarId: string; messageId: number } | null {
  if (!uri.startsWith(HERMES_URI_PREFIX)) return null;
  const match = uri.match(
    /^hermes:\/\/familiar\/([A-Za-z0-9._-]+)\/messages\/([1-9]\d*)$/,
  );
  if (!match?.[1] || !match[2]) return null;
  const messageId = Number(match[2]);
  return Number.isSafeInteger(messageId)
    ? { familiarId: match[1], messageId }
    : null;
}

export function isHermesMemoryUri(value: string): boolean {
  return parseHermesMemoryUri(value) !== null;
}

export async function listHermesMemory(
  options: HermesMemoryOptions,
): Promise<HermesMemoryListing> {
  const databasePath = stateDatabasePath(options.hermesHome);
  const provider = await configuredProvider(options.hermesHome);
  const baseStatus = { databasePath, provider };
  if (!existsSync(databasePath)) {
    return {
      entries: [],
      status: { ...baseStatus, available: false, error: "database-unavailable" },
    };
  }

  try {
    const { DatabaseSync } = await loadSqlite();
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      database.exec("PRAGMA query_only = ON");
      const rows = queryMessages(
        database,
        options.query ?? "",
        boundedLimit(options.limit),
      );
      return {
        entries: rows.map((row) =>
          rowToEntry(normalizeRow(row), databasePath, options.familiarId),
        ),
        status: { ...baseStatus, available: true },
      };
    } finally {
      database.close();
    }
  } catch {
    return {
      entries: [],
      status: { ...baseStatus, available: false, error: "database-unreadable" },
    };
  }
}

export async function readHermesMemory(
  uri: string,
  options: Pick<HermesMemoryOptions, "hermesHome" | "familiarId">,
): Promise<HermesMessageContent | null> {
  const reference = parseHermesMemoryUri(uri);
  if (!reference || reference.familiarId !== options.familiarId) return null;

  const databasePath = stateDatabasePath(options.hermesHome);
  if (!existsSync(databasePath)) return null;

  const { DatabaseSync } = await loadSqlite();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const raw = database
      .prepare(`
        SELECT
          m.id,
          m.session_id,
          m.role,
          substr(COALESCE(m.content, ''), 1, ?) AS content,
          length(COALESCE(m.content, '')) AS content_length,
          m.timestamp,
          COALESCE(NULLIF(s.title, ''), NULLIF(s.display_name, '')) AS session_title,
          s.source,
          s.cwd
        FROM messages m
        LEFT JOIN sessions s ON s.id = m.session_id
        WHERE m.id = ? AND (m.active = 1 OR m.compacted = 1)
      `)
      .get(MAX_CONTENT_LENGTH, reference.messageId);
    if (!raw) return null;

    const row = normalizeRow(raw);
    const originalLength = asFiniteNumber(raw.content_length);
    const truncated = originalLength > row.content.length;
    const sourceLines = [
      `**Session:** ${row.sessionTitle ?? row.sessionId}`,
      `**Role:** ${row.role}`,
      `**Recorded:** ${timestampIso(row.timestamp)}`,
      row.source ? `**Hermes source:** ${row.source}` : null,
      row.cwd ? `**Working directory:** \`${row.cwd}\`` : null,
      "**Access:** Read-only from `~/.hermes/state.db`",
    ].filter((line): line is string => Boolean(line));
    const truncationNotice = truncated
      ? "\n\n> Content was truncated at the Cave reader limit."
      : "";
    const content = `# ${messageTitle(row)}\n\n${sourceLines.join("\n\n")}\n\n---\n\n${row.content}${truncationNotice}`;
    const modified = timestampIso(row.timestamp);
    return {
      path: uri,
      content,
      size: Buffer.byteLength(content),
      modified,
      readOnly: true,
    };
  } finally {
    database.close();
  }
}

export function hermesDatabaseMetadata(
  options: Pick<HermesMemoryOptions, "hermesHome">,
): { size: number; modified: string } | null {
  const databasePath = stateDatabasePath(options.hermesHome);
  try {
    const stat = statSync(databasePath);
    return { size: stat.size, modified: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}
