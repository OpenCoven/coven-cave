import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { caveHome } from "../../coven-paths.ts";
import {
  parseClientV1PairingScopes,
  type ClientV1Scope,
} from "./contract.ts";
import type { ClientV1PairingApproved } from "./pairing-store.ts";

export const CLIENT_V1_CREDENTIAL_STORE_FILE = "client-v1-credentials.json";
export const CLIENT_V1_LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface ClientV1CredentialIssueInput {
  appName: ClientV1PairingApproved["appName"];
  installationId: ClientV1PairingApproved["installationId"];
  scopes: ClientV1PairingApproved["scopes"];
}

export interface ClientV1CredentialRecord {
  id: string;
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
  bearerHash: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revocationReason: string | null;
}

export interface ClientV1IssuedCredential {
  bearer: string;
  credential: ClientV1CredentialRecord;
}

export interface CredentialStore {
  issue(input: ClientV1CredentialIssueInput): Promise<ClientV1IssuedCredential>;
  verify(id: string, bearer: string): Promise<boolean>;
  findByBearer(bearer: string): Promise<ClientV1CredentialRecord | null>;
  revoke(id: string, reason: string): Promise<void>;
  reload(): Promise<Map<string, ClientV1CredentialRecord>>;
  readPersistedFile(): Promise<string>;
}

export interface CredentialStoreOptions {
  now?: () => number;
  root?: string;
}

type CredentialStoreFile = {
  version: 1;
  credentials: ClientV1CredentialRecord[];
};

const BEARER_HASH_RE = /^[a-f0-9]{64}$/;
const DECOY_BEARER_HASH = createHash("sha256")
  .update("cave-client-v1-credential-decoy")
  .digest("hex");

function hashBearer(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

function hashesEqual(leftHex: string, rightHex: string): boolean {
  return timingSafeEqual(Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex"));
}

function requireTimestamp(now: number): number {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("Client v1 credential timestamps must be finite non-negative numbers.");
  }
  return now;
}

function cloneRecord(record: ClientV1CredentialRecord): ClientV1CredentialRecord {
  return {
    ...record,
    scopes: [...record.scopes],
  };
}

function cloneMap(
  records: ReadonlyMap<string, ClientV1CredentialRecord>,
): Map<string, ClientV1CredentialRecord> {
  return new Map(Array.from(records, ([id, record]) => [id, cloneRecord(record)]));
}

function parseRecord(value: unknown): ClientV1CredentialRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || !record.id
    || typeof record.appName !== "string"
    || !record.appName
    || typeof record.installationId !== "string"
    || !record.installationId
    || typeof record.bearerHash !== "string"
    || !BEARER_HASH_RE.test(record.bearerHash)
    || typeof record.createdAt !== "number"
    || !Number.isFinite(record.createdAt)
    || record.createdAt < 0
    || (record.lastUsedAt !== null
      && (typeof record.lastUsedAt !== "number"
        || !Number.isFinite(record.lastUsedAt)
        || record.lastUsedAt < record.createdAt))
    || (record.revokedAt !== null
      && (typeof record.revokedAt !== "number"
        || !Number.isFinite(record.revokedAt)
        || record.revokedAt < record.createdAt))
    || (record.revocationReason !== null && typeof record.revocationReason !== "string")
  ) {
    return null;
  }

  let scopes: ClientV1Scope[];
  try {
    scopes = parseClientV1PairingScopes(record.scopes);
  } catch {
    return null;
  }

  return {
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    scopes,
    bearerHash: record.bearerHash,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt as number | null,
    revokedAt: record.revokedAt as number | null,
    revocationReason: record.revocationReason as string | null,
  };
}

function parseStore(raw: string): Map<string, ClientV1CredentialRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
  const file = parsed as Record<string, unknown>;
  if (file.version !== 1 || !Array.isArray(file.credentials)) return new Map();

  const records = new Map<string, ClientV1CredentialRecord>();
  for (const value of file.credentials) {
    const record = parseRecord(value);
    if (record && !records.has(record.id)) records.set(record.id, record);
  }
  return records;
}

async function writeStoreAtomic(
  path: string,
  records: ReadonlyMap<string, ClientV1CredentialRecord>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const file: CredentialStoreFile = {
    version: 1,
    credentials: Array.from(records.values(), cloneRecord),
  };
  try {
    await writeFile(temporaryPath, JSON.stringify(file, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function clientV1CredentialStorePath(root = caveHome()): string {
  return join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
}

export class FileCredentialStore implements CredentialStore {
  readonly #now: () => number;
  readonly #path: string;
  #loaded = false;
  #records = new Map<string, ClientV1CredentialRecord>();
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: CredentialStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#path = clientV1CredentialStorePath(options.root ?? caveHome());
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #loadFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#records = new Map();
        this.#loaded = true;
        return;
      }
      this.#records = new Map();
      this.#loaded = true;
      return;
    }
    this.#records = parseStore(raw);
    this.#loaded = true;
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.#loadFromDisk();
  }

  async #persist(): Promise<void> {
    await writeStoreAtomic(this.#path, this.#records);
  }

  async #recordUse(record: ClientV1CredentialRecord): Promise<ClientV1CredentialRecord> {
    const now = Math.max(
      requireTimestamp(this.#now()),
      record.createdAt,
      record.lastUsedAt ?? 0,
    );
    if (
      record.lastUsedAt !== null
      && now - record.lastUsedAt < CLIENT_V1_LAST_USED_WRITE_INTERVAL_MS
    ) {
      return record;
    }
    record.lastUsedAt = now;
    await this.#persist();
    return record;
  }

  async issue(input: ClientV1CredentialIssueInput): Promise<ClientV1IssuedCredential> {
    return this.#exclusive(async () => {
      await this.#ensureLoaded();
      const appName = input.appName.trim();
      const installationId = input.installationId.trim();
      if (!appName || !installationId) {
        throw new Error("Client v1 credential appName and installationId are required.");
      }
      const scopes = parseClientV1PairingScopes([...input.scopes]);
      const bearer = randomBytes(32).toString("base64url");
      const now = requireTimestamp(this.#now());
      const credential: ClientV1CredentialRecord = {
        id: randomUUID(),
        appName,
        installationId,
        scopes,
        bearerHash: hashBearer(bearer),
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
        revocationReason: null,
      };
      this.#records.set(credential.id, credential);
      await this.#persist();
      return {
        bearer,
        credential: cloneRecord(credential),
      };
    });
  }

  async verify(id: string, bearer: string): Promise<boolean> {
    return this.#exclusive(async () => {
      await this.#ensureLoaded();
      const record = this.#records.get(id);
      const matches = hashesEqual(record?.bearerHash ?? DECOY_BEARER_HASH, hashBearer(bearer));
      if (!record || record.revokedAt !== null || !matches) return false;
      await this.#recordUse(record);
      return true;
    });
  }

  async findByBearer(bearer: string): Promise<ClientV1CredentialRecord | null> {
    return this.#exclusive(async () => {
      await this.#ensureLoaded();
      const candidateHash = hashBearer(bearer);
      let match: ClientV1CredentialRecord | null = null;
      let activeMatches = 0;

      for (const record of this.#records.values()) {
        const matches = hashesEqual(record.bearerHash, candidateHash);
        if (record.revokedAt === null && matches) {
          activeMatches += 1;
          if (!match) match = record;
        }
      }

      if (activeMatches !== 1 || !match) return null;
      return cloneRecord(await this.#recordUse(match));
    });
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.#exclusive(async () => {
      await this.#ensureLoaded();
      const record = this.#records.get(id);
      if (!record || record.revokedAt !== null) return;
      const revocationReason = reason.trim();
      if (!revocationReason) {
        throw new Error("Client v1 credential revocation reason is required.");
      }
      record.revokedAt = Math.max(
        requireTimestamp(this.#now()),
        record.createdAt,
        record.lastUsedAt ?? 0,
      );
      record.revocationReason = revocationReason;
      await this.#persist();
    });
  }

  async reload(): Promise<Map<string, ClientV1CredentialRecord>> {
    return this.#exclusive(async () => {
      await this.#loadFromDisk();
      return cloneMap(this.#records);
    });
  }

  readPersistedFile(): Promise<string> {
    return readFile(this.#path, "utf8");
  }
}

export function createCredentialStore(
  options: CredentialStoreOptions = {},
): CredentialStore {
  return new FileCredentialStore(options);
}
