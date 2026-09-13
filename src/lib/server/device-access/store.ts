import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { caveHome } from "../../coven-paths.ts";
import { assertExclusivePathOwnership } from "../client-v1/path-ownership.ts";
import {
  DEVICE_CREDENTIAL_PREFIX,
  type DeviceAccessSnapshot,
  type DeviceAuditEvent,
  type DevicePeer,
  type DeviceRecord,
} from "./contract.ts";

const PAIRING_TTL_MS = 5 * 60_000;
const REQUEST_WINDOW_MS = 10 * 60_000;
const LAST_SEEN_INTERVAL_MS = 60_000;
const DATABASE_FILE = "device-access.sqlite";
const CREDENTIAL_RE = /^cave-device-v1\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const ERROR_STATUS = {
  invalid_request: 400,
  forbidden: 403,
  conflict: 409,
  not_found: 404,
  rate_limited: 429,
} as const;

export class DeviceAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: keyof typeof ERROR_STATUS, message: string, status: number = ERROR_STATUS[code]) {
    super(message);
    this.name = "DeviceAccessError";
    this.code = code;
    this.status = status;
  }
}

export interface DeviceAccessStore {
  policy(): Promise<{ enabled: boolean; allowedTailnets: string[] }>;
  snapshot(): Promise<DeviceAccessSnapshot>;
  setAllowedTailnets(tailnets: string[], actor: string): Promise<void>;
  request(
    peer: DevicePeer,
    input: { installationId: string; label: string },
  ): Promise<{ device: DeviceRecord; credential: string }>;
  inspect(credential: string, peer: DevicePeer): Promise<DeviceRecord | null>;
  verify(credential: string, peer: DevicePeer): Promise<DeviceRecord | null>;
  decide(
    id: string,
    decision: "allowed" | "denied" | "revoked",
    actor: string,
  ): Promise<DeviceRecord>;
  recordAccess(
    deviceId: string,
    input: { requestId: string; method: string; path: string; status: number },
  ): Promise<void>;
  close(): void;
}

function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value) || value.includes(DEVICE_CREDENTIAL_PREFIX)) {
    throw new DeviceAccessError("invalid_request", `Invalid ${field}.`);
  }
  return value.trim();
}

function tailnet(value: unknown): string {
  const normalized = text(value, "tailnet", 253).toLowerCase();
  const labels = normalized.split(".");
  if (labels.length < 3 || !normalized.endsWith(".ts.net")
    || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new DeviceAccessError("invalid_request", "Tailnets must be exact DNS names ending in .ts.net.");
  }
  return normalized;
}

function normalizePeer(peer: DevicePeer): DevicePeer {
  return {
    tailnet: tailnet(peer?.tailnet),
    nodeId: text(peer?.nodeId, "node ID"),
    userId: text(peer?.userId, "user ID"),
    loginName: text(peer?.loginName, "login name"),
    deviceName: text(peer?.deviceName, "device name"),
  };
}

function hashCredential(credential: string): Buffer {
  return createHash("sha256").update(credential).digest();
}

type Row = Record<string, SQLOutputValue>;

function policyEnabled(value: SQLOutputValue | undefined): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error("Device access policy mode is missing or invalid.");
  }
  return value === 1;
}

function deviceRecord(row: Row): DeviceRecord {
  return {
    id: row.id as string,
    installationId: row.installationId as string,
    label: row.label as string,
    peer: {
      tailnet: row.tailnet as string,
      nodeId: row.nodeId as string,
      userId: row.userId as string,
      loginName: row.loginName as string,
      deviceName: row.deviceName as string,
    },
    status: row.status as DeviceRecord["status"],
    createdAt: row.createdAt as number,
    pairingExpiresAt: row.pairingExpiresAt as number,
    decidedAt: row.decidedAt as number | null,
    decidedBy: row.decidedBy as string | null,
    lastSeenAt: row.lastSeenAt as number | null,
    revokedAt: row.revokedAt as number | null,
  };
}

// Existing policy evidence must survive migration, including an operator's
// explicit empty allowlist. Inferring the mode from the current list is unsafe.
const POLICY_SCHEMA = `
  CREATE TABLE policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
  ) STRICT;
  INSERT INTO policy (singleton, enabled)
    SELECT 1, CASE WHEN
      EXISTS(SELECT 1 FROM audit WHERE event = 'policy.updated')
      OR EXISTS(SELECT 1 FROM allowed_tailnets)
      OR EXISTS(SELECT 1 FROM devices)
    THEN 1 ELSE 0 END;
  PRAGMA user_version = 2;
`;

const SCHEMA = `
  CREATE TABLE allowed_tailnets (tailnet TEXT PRIMARY KEY NOT NULL) STRICT;
  CREATE TABLE devices (
    id TEXT PRIMARY KEY NOT NULL,
    installationId TEXT NOT NULL,
    label TEXT NOT NULL,
    tailnet TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    loginName TEXT NOT NULL,
    deviceName TEXT NOT NULL,
    credentialHash TEXT NOT NULL CHECK(length(credentialHash) = 64),
    status TEXT NOT NULL CHECK(status IN ('pending', 'allowed', 'denied', 'revoked', 'expired')),
    createdAt INTEGER NOT NULL,
    pairingExpiresAt INTEGER NOT NULL,
    decidedAt INTEGER,
    decidedBy TEXT,
    lastSeenAt INTEGER,
    revokedAt INTEGER
  ) STRICT;
  CREATE INDEX device_requests ON devices(tailnet, nodeId, createdAt);
  CREATE INDEX device_expiry ON devices(status, pairingExpiresAt);
  CREATE TABLE audit (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    deviceId TEXT REFERENCES devices(id),
    actor TEXT NOT NULL,
    event TEXT NOT NULL,
    requestId TEXT,
    method TEXT,
    path TEXT,
    status INTEGER
  ) STRICT;
  ${POLICY_SCHEMA}
`;

async function secureFile(path: string, required = false): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Device access database files must be regular files without symlinks or hardlinks: ${path}.`);
  }
  await assertExclusivePathOwnership(path, metadata, "Device access database file");
  await chmod(path, 0o600);
}

async function initializeLocation(root: string): Promise<string> {
  const configuredRoot = resolve(root);
  await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
  const metadata = await lstat(configuredRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Device access root must be a real directory, not a symlink.");
  }
  const physicalRoot = await realpath(configuredRoot);
  await assertExclusivePathOwnership(physicalRoot, metadata, "Device access root");
  await chmod(physicalRoot, 0o700);
  const file = join(physicalRoot, DATABASE_FILE);
  // SQLite opens sidecars itself; reject them before SQLite can follow a link.
  for (const suffix of ["", "-wal", "-shm", "-journal"]) await secureFile(file + suffix);
  try {
    const handle = await open(file, "wx", 0o600);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await secureFile(file, true);
  return file;
}

class SqliteDeviceAccessStore implements DeviceAccessStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number) {
    this.db = db;
    this.now = now;
  }

  private timestamp(): number {
    const at = this.now();
    if (!Number.isSafeInteger(at) || at < 0 || at > Number.MAX_SAFE_INTEGER - REQUEST_WINDOW_MS) {
      throw new Error("Device access timestamps must be non-negative safe integer milliseconds.");
    }
    return at;
  }

  private transaction<T>(operation: () => T): T {
    // Never await while holding this lock. Every process reads fresh policy and
    // credentials under the same write lock as its decision and audit append.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private audit(
    at: number,
    deviceId: string | null,
    actor: string,
    event: string,
    access?: { requestId: string; method: string; path: string; status: number },
  ): void {
    this.db.prepare(`
      INSERT INTO audit (id, at, deviceId, actor, event, requestId, method, path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), at, deviceId, actor, event,
      access?.requestId ?? null, access?.method ?? null, access?.path ?? null, access?.status ?? null,
    );
  }

  private find(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id);
  }

  private isEnabled(): boolean {
    return policyEnabled(this.db.prepare("SELECT enabled FROM policy WHERE singleton = 1").get()?.enabled);
  }

  private isTailnetAllowed(value: string): boolean {
    return this.isEnabled()
      && this.db.prepare("SELECT 1 FROM allowed_tailnets WHERE tailnet = ?").get(value) !== undefined;
  }

  private transition(row: Row, status: Exclude<DeviceRecord["status"], "pending">, actor: string, at: number): void {
    this.db.prepare(`
      UPDATE devices SET status = ?, decidedAt = ?, decidedBy = ?, revokedAt = ? WHERE id = ?
    `).run(status, at, actor, status === "revoked" ? at : null, row.id);
    this.audit(at, row.id as string, actor, `device.${status}`);
  }

  private expirePending(at: number): void {
    const expired = this.db.prepare(`
      SELECT * FROM devices WHERE status = 'pending' AND pairingExpiresAt <= ? ORDER BY rowid
    `).all(at);
    for (const row of expired) this.transition(row, "expired", "system:expiry", at);
  }

  private readPolicy(): { enabled: boolean; allowedTailnets: string[] } {
    // One read statement observes one committed policy, without a writer lock
    // or any scan/expiry of device records on the ingress hot path.
    const rows = this.db.prepare(`
      SELECT policy.enabled, allowed_tailnets.tailnet FROM policy
      LEFT JOIN allowed_tailnets ON 1 = 1
      WHERE policy.singleton = 1 ORDER BY allowed_tailnets.tailnet
    `).all();
    return {
      enabled: policyEnabled(rows[0]?.enabled),
      allowedTailnets: rows.filter((row) => row.tailnet !== null).map((row) => row.tailnet as string),
    };
  }

  async policy(): Promise<{ enabled: boolean; allowedTailnets: string[] }> {
    return this.readPolicy();
  }

  async snapshot(): Promise<DeviceAccessSnapshot> {
    return this.transaction(() => {
      this.expirePending(this.timestamp());
      return {
        ...this.readPolicy(),
        devices: this.db.prepare("SELECT * FROM devices ORDER BY rowid DESC").all().map(deviceRecord),
        events: this.db.prepare(`
          SELECT id, at, deviceId, actor, event, requestId, method, path, status
          FROM audit ORDER BY sequence DESC LIMIT 200
        `).all() as unknown as DeviceAuditEvent[],
      };
    });
  }

  async setAllowedTailnets(tailnets: string[], actor: string): Promise<void> {
    if (!Array.isArray(tailnets) || tailnets.length > 100) {
      throw new DeviceAccessError("invalid_request", "Provide at most 100 exact tailnets.");
    }
    const normalized = [...new Set(tailnets.map(tailnet))].sort();
    const by = text(actor, "actor");
    this.transaction(() => {
      const at = this.timestamp();
      const wasEnabled = this.isEnabled();
      this.expirePending(at);
      const previous = this.db.prepare("SELECT tailnet FROM allowed_tailnets ORDER BY tailnet")
        .all().map((row) => row.tailnet as string);
      this.db.exec("DELETE FROM allowed_tailnets");
      for (const value of normalized) {
        this.db.prepare("INSERT INTO allowed_tailnets (tailnet) VALUES (?)").run(value);
      }
      this.db.exec("UPDATE policy SET enabled = 1 WHERE singleton = 1");
      if (!wasEnabled) this.audit(at, null, by, "policy.enabled");
      this.audit(at, null, by, "policy.updated");
      for (const value of previous.filter((value) => !normalized.includes(value))) {
        this.audit(at, null, by, `policy.tailnet_removed:${value}`);
      }
      for (const value of normalized.filter((value) => !previous.includes(value))) {
        this.audit(at, null, by, `policy.tailnet_allowed:${value}`);
      }
      const removed = this.db.prepare(`
        SELECT * FROM devices WHERE status IN ('allowed', 'pending')
        AND tailnet NOT IN (SELECT tailnet FROM allowed_tailnets) ORDER BY rowid
      `).all();
      for (const row of removed) {
        this.transition(row, row.status === "allowed" ? "revoked" : "denied", by, at);
      }
    });
  }

  async request(
    peer: DevicePeer,
    input: { installationId: string; label: string },
  ): Promise<{ device: DeviceRecord; credential: string }> {
    const normalized = normalizePeer(peer);
    const installationId = text(input?.installationId, "installation ID");
    const label = text(input?.label, "device label");
    return this.transaction(() => {
      const at = this.timestamp();
      if (!this.isTailnetAllowed(normalized.tailnet)) {
        throw new DeviceAccessError("forbidden", "This tailnet is not allowed to request access.");
      }
      this.expirePending(at);
      const requests = this.db.prepare(`
        SELECT count(*) AS count FROM devices WHERE tailnet = ? AND nodeId = ? AND createdAt > ?
      `).get(normalized.tailnet, normalized.nodeId, at - REQUEST_WINDOW_MS)!;
      if ((requests.count as number) >= 5) {
        throw new DeviceAccessError("rate_limited", "This device has made too many pairing requests.");
      }
      const pending = this.db.prepare("SELECT count(*) AS count FROM devices WHERE status = 'pending'").get()!;
      if ((pending.count as number) >= 64) {
        throw new DeviceAccessError("rate_limited", "Too many devices are awaiting approval.");
      }
      const id = randomUUID();
      const credential = `${DEVICE_CREDENTIAL_PREFIX}${id}.${randomBytes(32).toString("base64url")}`;
      this.db.prepare(`
        INSERT INTO devices (
          id, installationId, label, tailnet, nodeId, userId, loginName, deviceName,
          credentialHash, status, createdAt, pairingExpiresAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        id, installationId, label, normalized.tailnet, normalized.nodeId, normalized.userId,
        normalized.loginName, normalized.deviceName, hashCredential(credential).toString("hex"),
        at, at + PAIRING_TTL_MS,
      );
      this.audit(at, id, `peer:${normalized.tailnet}/${normalized.nodeId}/${normalized.userId}`, "request.created");
      return { device: deviceRecord(this.find(id)!), credential };
    });
  }

  private authenticate(credential: string, peer: DevicePeer, allowedOnly: boolean): DeviceRecord | null {
    if (typeof credential !== "string") return null;
    const match = CREDENTIAL_RE.exec(credential);
    if (!match) return null;
    let normalized: DevicePeer;
    try {
      normalized = normalizePeer(peer);
    } catch (error) {
      if (error instanceof DeviceAccessError) return null;
      throw error;
    }
    return this.transaction(() => {
      const row = this.find(match[1]);
      const expected = row ? Buffer.from(row.credentialHash as string, "hex") : Buffer.alloc(32);
      if (!timingSafeEqual(hashCredential(credential), expected) || !row
        || row.tailnet !== normalized.tailnet || row.nodeId !== normalized.nodeId || row.userId !== normalized.userId) {
        return null;
      }
      const at = this.timestamp();
      if (row.status === "pending" && (row.pairingExpiresAt as number) <= at) {
        this.transition(row, "expired", "system:expiry", at);
      }
      const device = deviceRecord(this.find(match[1])!);
      if (!allowedOnly) return device;
      if (device.status !== "allowed" || !this.isTailnetAllowed(device.peer.tailnet)) return null;
      if (device.lastSeenAt === null || at - device.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
        this.db.prepare("UPDATE devices SET lastSeenAt = ? WHERE id = ?").run(at, device.id);
        device.lastSeenAt = at;
      }
      return device;
    });
  }

  async inspect(credential: string, peer: DevicePeer): Promise<DeviceRecord | null> {
    return this.authenticate(credential, peer, false);
  }

  async verify(credential: string, peer: DevicePeer): Promise<DeviceRecord | null> {
    return this.authenticate(credential, peer, true);
  }

  async decide(id: string, decision: "allowed" | "denied" | "revoked", actor: string): Promise<DeviceRecord> {
    const deviceId = text(id, "device ID");
    const by = text(actor, "actor");
    if (!["allowed", "denied", "revoked"].includes(decision)) {
      throw new DeviceAccessError("invalid_request", "Unknown device decision.");
    }
    const result = this.transaction(() => {
      const at = this.timestamp();
      this.expirePending(at);
      const row = this.find(deviceId);
      if (!row) return new DeviceAccessError("not_found", "Device request not found.");
      if ((decision === "revoked" && row.status !== "allowed")
        || (decision !== "revoked" && row.status !== "pending")) {
        return new DeviceAccessError("conflict", "This device cannot make that transition.");
      }
      if (decision === "allowed" && !this.isTailnetAllowed(row.tailnet as string)) {
        return new DeviceAccessError("forbidden", "This tailnet is no longer allowed.");
      }
      this.transition(row, decision, by, at);
      return deviceRecord(this.find(deviceId)!);
    });
    // Expiry is durable even when the requested decision is refused.
    if (result instanceof DeviceAccessError) throw result;
    return result;
  }

  async recordAccess(
    deviceId: string,
    input: { requestId: string; method: string; path: string; status: number },
  ): Promise<void> {
    const id = text(deviceId, "device ID");
    const requestId = text(input?.requestId, "request ID", 128);
    const method = text(input?.method, "HTTP method", 16);
    if (!/^[A-Z]+$/.test(method) || !Number.isInteger(input?.status)
      || (input.status !== 0 && (input.status < 100 || input.status > 599))) {
      throw new DeviceAccessError("invalid_request", "Invalid HTTP access metadata.");
    }
    if (typeof input.path !== "string" || input.path.length > 16_384
      || !input.path.startsWith("/") || input.path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(input.path)) {
      throw new DeviceAccessError("invalid_request", "Access paths must be origin-relative request paths.");
    }
    const path = text(input.path.split(/[?#]/, 1)[0], "access path", 2048);
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      throw new DeviceAccessError("invalid_request", "Invalid access path encoding.");
    }
    if (/[\u0000-\u001f\u007f]/.test(decodedPath) || decodedPath.includes(DEVICE_CREDENTIAL_PREFIX)) {
      throw new DeviceAccessError("invalid_request", "Invalid access path.");
    }
    this.transaction(() => {
      const device = this.find(id);
      if (!device) throw new DeviceAccessError("not_found", "Device request not found.");
      if (input.status === 0 && (device.status !== "allowed" || !this.isTailnetAllowed(device.tailnet as string))) {
        throw new DeviceAccessError("forbidden", "This device is no longer allowed to access the app.");
      }
      this.audit(this.timestamp(), id, `device:${id}`, "access", { requestId, method, path, status: input.status });
    });
  }

  close(): void {
    this.db.close();
  }
}

export async function createDeviceAccessStore(
  { root = join(caveHome(), "device-access"), now = Date.now }: { root?: string; now?: () => number } = {},
): Promise<DeviceAccessStore> {
  const file = await initializeLocation(root);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
    const journal = db.prepare("PRAGMA journal_mode = WAL").get();
    if (journal?.journal_mode !== "wal") throw new Error("Device access database requires WAL journaling.");
    db.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    try {
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version === 0) db.exec(SCHEMA);
      else if (version === 1) db.exec(POLICY_SCHEMA);
      else if (version !== 2) throw new Error("Unsupported device access database schema.");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const suffix of ["", "-wal", "-shm", "-journal"]) await secureFile(file + suffix, suffix === "");
    return new SqliteDeviceAccessStore(db, now);
  } catch (error) {
    db.close();
    throw error;
  }
}
