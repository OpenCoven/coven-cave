import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
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

function normalizeSecretKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function localVaultDir(): string {
  return caveHome();
}

function localVaultKeyPath(): string {
  return process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE?.trim() || join(/* turbopackIgnore: true */ localVaultDir(), "local-vault.key");
}

function localVaultPath(): string {
  return process.env.COVEN_CAVE_LOCAL_VAULT_FILE?.trim() || join(/* turbopackIgnore: true */ localVaultDir(), "local-vault.enc.json");
}

function writePrivateText(file: string, value: string): void {
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  writeFileSync(/* turbopackIgnore: true */ file, value, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(/* turbopackIgnore: true */ file, 0o600); } catch { /* Windows ignores POSIX modes. */ }
}

function readOrCreateKey(): Buffer {
  const file = localVaultKeyPath();
  if (existsSync(/* turbopackIgnore: true */ file)) {
    const raw = readFileSync(/* turbopackIgnore: true */ file, "utf8").trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    throw new Error("local encrypted vault key is invalid");
  }

  const key = randomBytes(32);
  writePrivateText(file, `${key.toString("base64")}\n`);
  return key;
}

function readStore(): LocalVaultStore {
  const file = localVaultPath();
  if (!existsSync(/* turbopackIgnore: true */ file)) return { version: 1, secrets: {} };
  try {
    const parsed = JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8")) as Partial<LocalVaultStore>;
    if (parsed.version !== 1 || !parsed.secrets || typeof parsed.secrets !== "object") {
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
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(/* turbopackIgnore: true */ tmp, 0o600); } catch { /* Windows ignores POSIX modes. */ }
  renameSync(/* turbopackIgnore: true */ tmp, file);
}

export function setLocalEncryptedSecret(key: string, value: string): void {
  const normalized = normalizeSecretKey(key);
  if (!normalized) throw new Error("key is required");
  if (!value) throw new Error("secret value is required");

  const vaultKey = readOrCreateKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
  cipher.setAAD(Buffer.from(normalized, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const store = readStore();
  store.secrets[normalized] = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

export function getLocalEncryptedSecret(key: string): string | null {
  const normalized = normalizeSecretKey(key);
  if (!normalized) return null;
  const entry = readStore().secrets[normalized];
  if (!entry) return null;

  const vaultKey = readOrCreateKey();
  const decipher = createDecipheriv("aes-256-gcm", vaultKey, Buffer.from(entry.iv, "base64"));
  decipher.setAAD(Buffer.from(normalized, "utf8"));
  decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function hasLocalEncryptedSecret(key: string): boolean {
  const normalized = normalizeSecretKey(key);
  return !!normalized && !!readStore().secrets[normalized];
}

export function deleteLocalEncryptedSecret(key: string): void {
  const normalized = normalizeSecretKey(key);
  if (!normalized) return;
  const store = readStore();
  if (!store.secrets[normalized]) return;
  delete store.secrets[normalized];
  writeStore(store);
}
