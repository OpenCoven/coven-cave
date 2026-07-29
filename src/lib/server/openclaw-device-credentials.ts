import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * OS-backed paired-device credential store for OpenClaw Gateway dispatch.
 *
 * The published `@openclaw/gateway-client` delegates device-identity creation,
 * challenge signing, and device-token lifecycle to host-owned dependencies.
 * Cave backs those with the macOS Keychain through `/usr/bin/security` so a
 * write-capable Gateway session can never be activated from process
 * environment tokens: `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_DEVICE_TOKEN`
 * are deliberately never read, and the `env` bag the client passes to the
 * token hooks is deliberately ignored. Platforms without a supported OS
 * credential store fail closed to the CLI/plain-chat fallback.
 */

const KEYCHAIN_SERVICE = "coven-cave.openclaw-gateway";
const IDENTITY_ACCOUNT = "device-identity";
const SECURITY_BIN = "/usr/bin/security";
const IDENTITY_VERSION = 1;
const TOKEN_VERSION = 1;
const ED25519_RAW_KEY_LENGTH = 32;
/** Exit statuses of the `security` tool for the two expected non-zero cases. */
const SECURITY_ITEM_NOT_FOUND = 44;
const SECURITY_DUPLICATE_ITEM = 45;
/** Keychain command values are pinned to this alphabet before quoting. */
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9._+/=-]+$/;

export type OpenClawDeviceIdentity = {
  deviceId: string;
  privateKeyPem: string;
  publicKeyPem: string;
};

export type OpenClawDeviceTokenRecord = {
  token?: string;
  scopes?: string[];
};

export type OpenClawCredentialStoreStatus = { available: boolean; reason?: string };

export class OpenClawCredentialStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenClawCredentialStoreError";
  }
}

type SecurityResult = { status: number; stdout: string };

export type OpenClawCredentialStoreDeps = {
  platform?: NodeJS.Platform;
  securityBinaryExists?: () => boolean;
  /**
   * Runs the `security` tool. `input`, when present, is the tool's stdin in
   * `-i` command mode — the only channel secrets may travel through; argv is
   * visible to every process on the machine.
   */
  runSecurity?: (args: string[], input?: string) => SecurityResult;
};

export type OpenClawDeviceCredentialStore = {
  status: () => OpenClawCredentialStoreStatus;
  /** Throws {@link OpenClawCredentialStoreError}; never silently regenerates a paired identity. */
  loadOrCreateDeviceIdentity: () => OpenClawDeviceIdentity;
  loadDeviceAuthToken: (params: { deviceId: string; role: string }) => OpenClawDeviceTokenRecord | null;
  storeDeviceAuthToken: (params: { deviceId: string; role: string; token: string; scopes: string[] }) => void;
  clearDeviceAuthToken: (params: { deviceId: string; role: string }) => void;
};

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function ed25519RawPublicKey(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new OpenClawCredentialStoreError("OpenClaw device public key is not an Ed25519 key");
  }
  const spki = key.export({ type: "spki", format: "der" });
  return Buffer.from(spki.subarray(spki.length - ED25519_RAW_KEY_LENGTH));
}

/** Matches the Gateway contract: base64url of the raw Ed25519 signature over the UTF-8 payload. */
export function signOpenClawDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new OpenClawCredentialStoreError("OpenClaw device private key is not an Ed25519 key");
  }
  return base64Url(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

/** Matches the Gateway contract: base64url of the raw 32-byte Ed25519 public key. */
export function openClawPublicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64Url(ed25519RawPublicKey(publicKeyPem));
}

function deviceIdFromPublicKeyPem(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(ed25519RawPublicKey(publicKeyPem)).digest("hex");
}

function generateDeviceIdentity(): OpenClawDeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { deviceId: deviceIdFromPublicKeyPem(publicKeyPem), publicKeyPem, privateKeyPem };
}

function safeValue(value: string, label: string): string {
  if (!SAFE_VALUE_PATTERN.test(value)) {
    throw new OpenClawCredentialStoreError(`OpenClaw credential ${label} contains unsupported characters`);
  }
  return value;
}

function tokenAccount(deviceId: string, role: string): string {
  return `device-token.${safeValue(role, "role")}.${safeValue(deviceId, "device id")}`;
}

function encodePayload(record: unknown): string {
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64");
}

function decodePayload(secret: string): unknown {
  return JSON.parse(Buffer.from(secret.trim(), "base64").toString("utf8"));
}

function defaultRunSecurity(args: string[], input?: string): SecurityResult {
  try {
    const stdout = execFileSync(SECURITY_BIN, args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(input === undefined ? {} : { input }),
    });
    return { status: 0, stdout };
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    const stdout = (error as { stdout?: unknown }).stdout;
    return {
      status: typeof status === "number" ? status : 1,
      stdout: typeof stdout === "string" ? stdout : "",
    };
  }
}

function parseStoredIdentity(secret: string): OpenClawDeviceIdentity {
  let record: unknown;
  try {
    record = decodePayload(secret);
  } catch (error) {
    throw invalidIdentityError(error);
  }
  if (
    !record ||
    typeof record !== "object" ||
    (record as { version?: unknown }).version !== IDENTITY_VERSION
  ) {
    throw invalidIdentityError();
  }
  const { deviceId, publicKeyPem, privateKeyPem } = record as Record<string, unknown>;
  if (typeof deviceId !== "string" || typeof publicKeyPem !== "string" || typeof privateKeyPem !== "string") {
    throw invalidIdentityError();
  }
  try {
    if (deviceIdFromPublicKeyPem(publicKeyPem) !== deviceId) throw invalidIdentityError();
    // Proves the private key parses and belongs to the stored public key.
    const probe = signOpenClawDevicePayload(privateKeyPem, "coven-cave.identity-probe");
    const valid = crypto.verify(
      null,
      Buffer.from("coven-cave.identity-probe", "utf8"),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(probe, "base64url"),
    );
    if (!valid) throw invalidIdentityError();
  } catch (error) {
    throw error instanceof OpenClawCredentialStoreError ? error : invalidIdentityError(error);
  }
  return { deviceId, publicKeyPem, privateKeyPem };
}

function invalidIdentityError(cause?: unknown): OpenClawCredentialStoreError {
  return new OpenClawCredentialStoreError(
    `The macOS Keychain holds an invalid OpenClaw device identity (service "${KEYCHAIN_SERVICE}"). ` +
      "Cave will not silently replace a paired identity; delete the item in Keychain Access to re-pair.",
    cause === undefined ? undefined : { cause },
  );
}

export function createOpenClawDeviceCredentialStore(
  deps: OpenClawCredentialStoreDeps = {},
): OpenClawDeviceCredentialStore {
  const platform = deps.platform ?? process.platform;
  const securityBinaryExists = deps.securityBinaryExists ?? (() => fs.existsSync(SECURITY_BIN));
  const runSecurity = deps.runSecurity ?? defaultRunSecurity;

  const status = (): OpenClawCredentialStoreStatus => {
    if (platform !== "darwin") {
      return {
        available: false,
        reason: `OpenClaw Gateway dispatch requires the macOS Keychain credential store; ${platform} has no supported OS credential store`,
      };
    }
    if (!securityBinaryExists()) {
      return { available: false, reason: "The macOS security tool is unavailable for the OpenClaw credential store" };
    }
    return { available: true };
  };

  const requireAvailable = () => {
    const current = status();
    if (!current.available) {
      throw new OpenClawCredentialStoreError(current.reason ?? "The OpenClaw credential store is unavailable");
    }
  };

  const readSecret = (account: string): string | null => {
    const result = runSecurity(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]);
    if (result.status === 0) return result.stdout;
    if (result.status === SECURITY_ITEM_NOT_FOUND) return null;
    throw new OpenClawCredentialStoreError(
      `The macOS Keychain rejected an OpenClaw credential read (security exited ${result.status})`,
    );
  };

  // `-i` command mode keeps the secret on stdin; `add-generic-password -w <v>`
  // on argv would expose it to every process on the machine.
  const writeSecret = (account: string, secret: string, params: { update: boolean }): number => {
    const command = [
      "add-generic-password",
      params.update ? "-U" : null,
      `-s "${safeValue(KEYCHAIN_SERVICE, "service")}"`,
      `-a "${safeValue(account, "account")}"`,
      `-w "${safeValue(secret, "secret")}"`,
    ]
      .filter(Boolean)
      .join(" ");
    const result = runSecurity(["-i"], `${command}\n`);
    return result.status;
  };

  const deleteSecret = (account: string): void => {
    const result = runSecurity(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]);
    if (result.status !== 0 && result.status !== SECURITY_ITEM_NOT_FOUND) {
      throw new OpenClawCredentialStoreError(
        `The macOS Keychain rejected an OpenClaw credential removal (security exited ${result.status})`,
      );
    }
  };

  return {
    status,
    loadOrCreateDeviceIdentity: () => {
      requireAvailable();
      const existing = readSecret(IDENTITY_ACCOUNT);
      if (existing !== null) return parseStoredIdentity(existing);
      const identity = generateDeviceIdentity();
      const payload = encodePayload({ version: IDENTITY_VERSION, ...identity });
      const written = writeSecret(IDENTITY_ACCOUNT, payload, { update: false });
      if (written === 0) return identity;
      if (written === SECURITY_DUPLICATE_ITEM) {
        // Another Cave process created the identity between our read and
        // write. The keychain copy is the paired one; ours is discarded.
        const winner = readSecret(IDENTITY_ACCOUNT);
        if (winner !== null) return parseStoredIdentity(winner);
      }
      throw new OpenClawCredentialStoreError(
        `The macOS Keychain rejected the OpenClaw device identity write (security exited ${written})`,
      );
    },
    // The token hooks run inside the Gateway client's connect path; a keychain
    // hiccup there must degrade to "no stored token" (fresh challenge pairing),
    // not tear down the transport with an exception it cannot attribute.
    loadDeviceAuthToken: ({ deviceId, role }) => {
      try {
        const secret = readSecret(tokenAccount(deviceId, role));
        if (secret === null) return null;
        const record = decodePayload(secret);
        if (!record || typeof record !== "object" || (record as { version?: unknown }).version !== TOKEN_VERSION) {
          return null;
        }
        const { token, scopes } = record as Record<string, unknown>;
        if (typeof token !== "string" || token.length === 0) return null;
        return {
          token,
          scopes: Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [],
        };
      } catch {
        return null;
      }
    },
    storeDeviceAuthToken: ({ deviceId, role, token, scopes }) => {
      try {
        if (typeof token !== "string" || token.length === 0) return;
        const payload = encodePayload({ version: TOKEN_VERSION, token, scopes });
        writeSecret(tokenAccount(deviceId, role), payload, { update: true });
      } catch {
        // A token that fails to persist only costs a re-pair on the next
        // connect; it must not break the in-flight authenticated session.
      }
    },
    clearDeviceAuthToken: ({ deviceId, role }) => {
      try {
        deleteSecret(tokenAccount(deviceId, role));
      } catch {
        // Same degradation contract as storeDeviceAuthToken.
      }
    },
  };
}

export function openClawDeviceCredentialStoreStatus(
  deps: OpenClawCredentialStoreDeps = {},
): OpenClawCredentialStoreStatus {
  return createOpenClawDeviceCredentialStore(deps).status();
}
