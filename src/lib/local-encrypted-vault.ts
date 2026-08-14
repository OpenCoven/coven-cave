import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { caveHome } from "./coven-paths.ts";

type EncryptedSecret = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
};

type LocalVaultStore = {
  version: 1;
  secrets: Record<string, EncryptedSecret>;
};

export type LocalEncryptedSecretSnapshot = {
  value: string;
  revision: string;
};

const LOCK_WAIT_MS = 5_000;
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FIXED_VAULT_ERRORS = new Set([
  "key is required",
  "secret value is required",
  "local encrypted vault is busy",
  "local encrypted vault is unavailable",
  "local encrypted vault key is invalid",
]);

function normalizeSecretKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function localVaultDir(): string {
  return caveHome();
}

function localVaultKeyPath(): string {
  return process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE?.trim()
    || join(/* turbopackIgnore: true */ localVaultDir(), "local-vault.key");
}

function localVaultPath(): string {
  return process.env.COVEN_CAVE_LOCAL_VAULT_FILE?.trim()
    || join(/* turbopackIgnore: true */ localVaultDir(), "local-vault.enc.json");
}

function localVaultCoordinationPath(): string {
  return `${localVaultPath()}.coord.sqlite`;
}

function fixedVaultError(message: string): Error {
  return new Error(message);
}

function sanitizedVaultError(error: unknown): never {
  if (error instanceof Error && FIXED_VAULT_ERRORS.has(error.message)) {
    throw error;
  }
  throw fixedVaultError("local encrypted vault is unavailable");
}

type VaultLock = {
  database: DatabaseSync;
};

function sqliteLockIsBusy(error: unknown): boolean {
  const sqliteError = error as { errcode?: unknown };
  return sqliteError?.errcode === 5 || sqliteError?.errcode === 6;
}

function acquireVaultLock(): VaultLock {
  const file = localVaultCoordinationPath();
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(file);
    try {
      chmodSync(/* turbopackIgnore: true */ file, 0o600);
    } catch {
      // Windows ignores POSIX modes.
    }
    database.exec(`PRAGMA busy_timeout = ${LOCK_WAIT_MS}`);
    database.exec("PRAGMA journal_mode = DELETE");
    database.exec("BEGIN IMMEDIATE");
    return { database };
  } catch (error) {
    if (database) {
      try {
        if (database.isTransaction) database.exec("ROLLBACK");
      } catch {
        // Closing the connection below still releases every SQLite lock.
      }
      try {
        database.close();
      } catch {
        // The fixed outward error is sufficient.
      }
    }
    throw fixedVaultError(
      sqliteLockIsBusy(error)
        ? "local encrypted vault is busy"
        : "local encrypted vault is unavailable",
    );
  }
}

function releaseVaultLock(lock: VaultLock): void {
  let failed = false;
  try {
    if (lock.database.isTransaction) lock.database.exec("ROLLBACK");
  } catch {
    failed = true;
  }
  try {
    lock.database.close();
  } catch {
    failed = true;
  }
  if (failed) throw fixedVaultError("local encrypted vault is unavailable");
}

function withVaultMutationLock<T>(operation: () => T): T {
  const lock = acquireVaultLock();
  try {
    try {
      return operation();
    } catch (error) {
      return sanitizedVaultError(error);
    }
  } finally {
    releaseVaultLock(lock);
  }
}

function decodeVaultKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length === 32) return key;
  throw fixedVaultError("local encrypted vault key is invalid");
}

function readExistingVaultKey(file: string): Buffer {
  try {
    return decodeVaultKey(
      readFileSync(/* turbopackIgnore: true */ file, "utf8"),
    );
  } catch (error) {
    return sanitizedVaultError(error);
  }
}

function readOrCreateKey(): Buffer {
  const file = localVaultKeyPath();
  if (existsSync(/* turbopackIgnore: true */ file)) {
    return readExistingVaultKey(file);
  }

  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  const key = randomBytes(32);
  let handle: number;
  try {
    handle = openSync(/* turbopackIgnore: true */ file, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return readExistingVaultKey(file);
    }
    throw fixedVaultError("local encrypted vault is unavailable");
  }

  try {
    writeFileSync(handle, `${key.toString("base64")}\n`, {
      encoding: "utf8",
    });
    try {
      chmodSync(/* turbopackIgnore: true */ file, 0o600);
    } catch {
      // Windows ignores POSIX modes.
    }
    return key;
  } catch {
    try {
      closeSync(handle);
    } catch {
      // Continue to cleanup the exclusively created path.
    }
    try {
      unlinkSync(/* turbopackIgnore: true */ file);
    } catch {
      // The fixed outward error is sufficient.
    }
    throw fixedVaultError("local encrypted vault is unavailable");
  } finally {
    try {
      closeSync(handle);
    } catch {
      // The key bytes were synchronously written before return.
    }
  }
}

function readStore(): LocalVaultStore {
  const file = localVaultPath();
  if (!existsSync(/* turbopackIgnore: true */ file)) {
    return { version: 1, secrets: {} };
  }
  try {
    const parsed = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ file, "utf8"),
    ) as Partial<LocalVaultStore>;
    if (
      parsed.version !== 1
      || !parsed.secrets
      || typeof parsed.secrets !== "object"
    ) {
      return { version: 1, secrets: {} };
    }
    return { version: 1, secrets: parsed.secrets };
  } catch {
    return { version: 1, secrets: {} };
  }
}

function writeStore(store: LocalVaultStore): void {
  const file = localVaultPath();
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(
      /* turbopackIgnore: true */ temporary,
      `${JSON.stringify(store, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    try {
      chmodSync(/* turbopackIgnore: true */ temporary, 0o600);
    } catch {
      // Windows ignores POSIX modes.
    }
    renameSync(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ file,
    );
  } finally {
    try {
      unlinkSync(/* turbopackIgnore: true */ temporary);
    } catch {
      // Rename removes the temporary path; failures leave no reusable name.
    }
  }
}

function encryptSecret(
  normalized: string,
  value: string,
  vaultKey: Buffer,
): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
  cipher.setAAD(Buffer.from(normalized, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

function decryptSecret(
  normalized: string,
  entry: EncryptedSecret,
): string {
  const vaultKey = readOrCreateKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    vaultKey,
    Buffer.from(entry.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(normalized, "utf8"));
  decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function encryptedSecretRevision(
  normalized: string,
  entry: EncryptedSecret,
): string {
  const identity = JSON.stringify([
    normalized,
    entry.v,
    entry.alg,
    entry.iv,
    entry.tag,
    entry.ciphertext,
    entry.updatedAt,
  ]);
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

function requireNormalizedKey(key: string): string {
  const normalized = normalizeSecretKey(key);
  if (!normalized) throw fixedVaultError("key is required");
  return normalized;
}

function requireSecretValue(value: string): void {
  if (!value) throw fixedVaultError("secret value is required");
}

export function setLocalEncryptedSecret(key: string, value: string): void {
  const normalized = requireNormalizedKey(key);
  requireSecretValue(value);
  withVaultMutationLock(() => {
    const vaultKey = readOrCreateKey();
    const store = readStore();
    store.secrets[normalized] = encryptSecret(normalized, value, vaultKey);
    writeStore(store);
  });
}

export function getLocalEncryptedSecretSnapshot(
  key: string,
): LocalEncryptedSecretSnapshot | null {
  const normalized = normalizeSecretKey(key);
  if (!normalized) return null;
  const entry = readStore().secrets[normalized];
  if (!entry) return null;
  return {
    value: decryptSecret(normalized, entry),
    revision: encryptedSecretRevision(normalized, entry),
  };
}

export function getLocalEncryptedSecret(key: string): string | null {
  return getLocalEncryptedSecretSnapshot(key)?.value ?? null;
}

export function hasLocalEncryptedSecret(key: string): boolean {
  const normalized = normalizeSecretKey(key);
  return !!normalized && !!readStore().secrets[normalized];
}

export function setLocalEncryptedSecretIfRevision(
  key: string,
  expectedRevision: string,
  value: string,
): boolean {
  if (!REVISION_PATTERN.test(expectedRevision)) return false;
  const normalized = requireNormalizedKey(key);
  requireSecretValue(value);
  return withVaultMutationLock(() => {
    const store = readStore();
    const current = store.secrets[normalized];
    if (
      !current
      || encryptedSecretRevision(normalized, current) !== expectedRevision
    ) {
      return false;
    }
    const vaultKey = readOrCreateKey();
    store.secrets[normalized] = encryptSecret(normalized, value, vaultKey);
    writeStore(store);
    return true;
  });
}

export function deleteLocalEncryptedSecret(key: string): void {
  const normalized = normalizeSecretKey(key);
  if (!normalized) return;
  withVaultMutationLock(() => {
    const store = readStore();
    if (!store.secrets[normalized]) return;
    delete store.secrets[normalized];
    writeStore(store);
  });
}
