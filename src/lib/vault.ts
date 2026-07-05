/**
 * Cave Vault — resolves env vars from encrypted local secrets or 1Password references
 *
 * vault.yaml maps ENV_VAR_NAME → { storage: "encrypted" } or { ref: "op://Vault/Item/field", ... }
 *
 * Resolution priority:
 *   1. Already in process.env (e.g. set by .env.local or OS env) → use as-is
 *   2. Writable .env.local legacy fallback → use as-is
 *   3. Local encrypted vault → decrypt into process memory
 *   4. vault.yaml has a ref for this key → resolve via `op read`
 *   5. undefined
 *
 * Resolved values are cached in process.env for the lifetime of the process
 * so subsequent calls are instant. The raw secret value is NEVER written to
 * any file — it lives only in process memory.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { covenHome } from "./coven-paths.ts";
import { readEnvLocalAll, readEnvLocalValue } from "./env-file.ts";
import { getLocalEncryptedSecret, hasLocalEncryptedSecret } from "./local-encrypted-vault.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultEntry = {
  ref?: string;
  storage?: "1password" | "encrypted";
  description?: string;
  required?: boolean;
};

export type VaultMap = Record<string, VaultEntry>;

export type VaultStatus = "resolved" | "configured" | "encrypted" | "env-only" | "unresolved" | "error" | "no-ref";

export type VaultMappingStatus = {
  key: string;
  ref: string | null;
  storage: "1password" | "encrypted" | null;
  description: string | null;
  required: boolean;
  status: VaultStatus;
  hasValue: boolean;  // true if currently resolvable — never exposes the value
  error?: string;
};

// ── Paths ─────────────────────────────────────────────────────────────────────

function isBundle(): boolean {
  return process.env.COVEN_CAVE_BUNDLE === "1";
}

/**
 * Path to the vault reference-map file (no secrets — only `op://` refs).
 *
 * In packaged desktop builds the process runs with its cwd inside the
 * read-only, code-signed `.app` bundle, so editing the map in the UI (which
 * rewrites this file) must target a writable per-user location. Writing into
 * the bundle breaks its signature seal → Gatekeeper rejects the app and the
 * in-place auto-updater can no longer replace it. In bundle mode the file lives
 * under `<covenHome>/cave/`, seeded once from the bundle's shipped map.
 *
 * Resolution (first hit wins): `COVEN_VAULT_FILE` → bundle path → `<cwd>/vault.yaml`.
 */
function vaultYamlPath(): string {
  const override = process.env.COVEN_VAULT_FILE?.trim();
  if (override) return override;
  if (isBundle()) return join(covenHome(), "cave", "vault.yaml");
  return join(process.cwd(), "vault.yaml");
}

/** Read-only vault map shipped inside the bundle (cwd at runtime). */
function bundledSeedVaultPath(): string {
  return join(process.cwd(), "vault.yaml");
}

let _vaultSeedChecked = false;

/** First-run seed for bundle mode: copy the bundle's shipped reference map into
 *  the writable location once. Existence is the "seeded" marker. No-op outside
 *  bundle mode or when `COVEN_VAULT_FILE` is set. */
function seedVaultIfNeeded(): void {
  if (!isBundle()) return;
  if (process.env.COVEN_VAULT_FILE?.trim()) return;
  if (_vaultSeedChecked) return;
  _vaultSeedChecked = true;
  const dest = vaultYamlPath();
  if (existsSync(dest)) return;
  const seed = bundledSeedVaultPath();
  if (resolve(seed) === resolve(dest)) return;
  try {
    if (!existsSync(seed)) return;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(seed, dest);
  } catch {
    // Best-effort: a failed seed just means the map starts empty.
  }
}

// ── Vault loader ──────────────────────────────────────────────────────────────

let _vaultMap: VaultMap | null = null;

export function loadVaultMap(force = false): VaultMap {
  if (_vaultMap && !force) return _vaultMap;
  seedVaultIfNeeded();
  const vaultYaml = vaultYamlPath();
  if (!existsSync(vaultYaml)) { _vaultMap = {}; return {}; }
  try {
    const raw = readFileSync(vaultYaml, "utf8");
    const parsed = parseYaml(raw) as VaultMap | null;
    _vaultMap = parsed ?? {};
    return _vaultMap;
  } catch {
    _vaultMap = {};
    return {};
  }
}

export function saveVaultMap(map: VaultMap): void {
  // Serialise back to YAML manually (keeps comments stripped but structure clean)
  const lines = [
    "# Cave Vault — env var → encrypted local secret or 1Password reference map",
    "#",
    "# Format:",
    '#   ENV_VAR_NAME:',
    '#     storage: "encrypted"',
    "#   ANOTHER_ENV_VAR:",
    '#     ref: "op://VaultName/ItemTitle/field"',
    '#     description: "human-readable note"',
    "#     required: false",
    "#",
    "# Secrets are NEVER stored here — only storage metadata or an op:// reference.",
    "# Safe to commit; contains no credentials.",
    "",
  ];
  for (const [key, entry] of Object.entries(map)) {
    lines.push(`${key}:`);
    if (entry.storage === "encrypted") {
      lines.push('  storage: "encrypted"');
    } else if (entry.ref) {
      lines.push(`  ref: "${entry.ref}"`);
    }
    if (entry.description) lines.push(`  description: "${entry.description.replace(/"/g, "'")}"`);
    if (entry.required) lines.push(`  required: true`);
    lines.push("");
  }
  const vaultYaml = vaultYamlPath();
  mkdirSync(dirname(vaultYaml), { recursive: true });
  writeFileSync(vaultYaml, lines.join("\n"), "utf8");
  _vaultMap = map; // bust cache
}

// ── op resolver ───────────────────────────────────────────────────────────────

const OP_REF_PREFIX = "op://";
const OP_REF_MAX_LENGTH = 2048;
const OP_REF_FORBIDDEN_CHARS = /[\0\r\n`"$\\<>|;&]/;

export function validateOpRef(ref: unknown): string | null {
  if (typeof ref !== "string") return "ref must be a string";
  if (!ref.startsWith(OP_REF_PREFIX)) return "ref must start with op://";
  if (ref.length > OP_REF_MAX_LENGTH) return "ref is too long";
  if (OP_REF_FORBIDDEN_CHARS.test(ref)) return "ref contains invalid characters";

  const path = ref.slice(OP_REF_PREFIX.length);
  const segments = path.split("/");
  if (segments.length < 3 || segments.some((segment) => !segment.trim())) {
    return "ref must include vault, item, and field segments";
  }

  return null;
}

/** Call `op read` to fetch a secret reference. Returns null on failure. */
function opRead(ref: string): string | null {
  if (validateOpRef(ref)) return null;

  try {
    const value = execFileSync("op", ["read", ref], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 8000,
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Resolve an env var by key.
 * Checks process.env first, then local encrypted vault, then vault.yaml → `op read`.
 * Caches in process.env on success.
 * Never logs or persists the value to disk.
 */
export function resolveSecret(key: string): string | undefined {
  // Already in env (set via OS, .env.local, or prior resolve)
  if (process.env[key]?.trim()) return process.env[key]!.trim();

  // Persisted in the writable .env.local (the in-app GitHub PAT form writes
  // here). In packaged builds this lives outside the read-only bundle, where
  // Next no longer auto-loads it into process.env at boot — read it directly
  // and cache for the process lifetime.
  const fromFile = readEnvLocalValue(key);
  if (fromFile) {
    process.env[key] = fromFile;
    return fromFile;
  }

  const map = loadVaultMap();
  const entry = map[key];

  const localEncrypted = entry?.storage === "encrypted" || hasLocalEncryptedSecret(key)
    ? getLocalEncryptedSecret(key)
    : null;
  if (localEncrypted?.trim()) {
    process.env[key] = localEncrypted.trim();
    return localEncrypted.trim();
  }

  // Try 1Password vault reference
  if (!entry?.ref) return undefined;

  const value = opRead(entry.ref);
  if (value) {
    process.env[key] = value; // cache for process lifetime
    return value;
  }
  return undefined;
}

/** Check if a key is resolvable without returning the value.
 *
 * This is a materializing check: it may decrypt local secrets, run `op read`,
 * and cache the resolved secret in process.env. Do not call it from read-only
 * status endpoints that only need configuration metadata.
 */
export function canResolve(key: string): boolean {
  return !!resolveSecret(key);
}

/** Check whether a key appears configured without reading or caching its value. */
export function hasConfiguredSecretMetadata(key: string): boolean {
  if (process.env[key]?.trim()) return true;
  if (readEnvLocalValue(key) !== undefined) return true;

  const map = loadVaultMap();
  const entry = map[key];
  if (entry?.storage === "encrypted" || hasLocalEncryptedSecret(key)) return true;
  return !!entry?.ref;
}

// ── Status reporter (for /api/vault UI) ──────────────────────────────────────

export function getVaultMetadataStatuses(): VaultMappingStatus[] {
  const map = loadVaultMap(true); // always fresh for status checks
  const envLocal = readEnvLocalAll(); // read once for all entries
  return Object.entries(map).map(([key, entry]) => {
    const inEnv = !!(process.env[key]?.trim()) || key in envLocal;
    const hasEncrypted = entry.storage === "encrypted" || hasLocalEncryptedSecret(key);

    if (inEnv) {
      return {
        key, ref: entry.ref ?? null, description: entry.description ?? null,
        storage: entry.storage ?? (entry.ref ? "1password" : null),
        required: entry.required ?? false,
        status: "env-only" as VaultStatus, hasValue: true,
      };
    }

    if (hasEncrypted) {
      return {
        key, ref: entry.ref ?? null, description: entry.description ?? null,
        storage: "encrypted",
        required: entry.required ?? false,
        status: "encrypted" as VaultStatus, hasValue: true,
      };
    }

    if (entry.ref) {
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        storage: "1password",
        required: entry.required ?? false,
        status: "configured" as VaultStatus, hasValue: false,
      };
    }

    return {
      key, ref: null, description: entry.description ?? null,
      storage: entry.storage ?? null,
      required: entry.required ?? false,
      status: "no-ref" as VaultStatus, hasValue: false,
    };
  });
}

export function getVaultStatuses(): VaultMappingStatus[] {
  const map = loadVaultMap(true); // always fresh for status checks
  return Object.entries(map).map(([key, entry]) => {
    const inEnv = !!(process.env[key]?.trim());

    if (entry.storage === "encrypted" || hasLocalEncryptedSecret(key)) {
      try {
        const value = getLocalEncryptedSecret(key);
        if (value) {
          process.env[key] = value;
          return {
            key, ref: entry.ref ?? null, description: entry.description ?? null,
            storage: "encrypted",
            required: entry.required ?? false,
            status: "encrypted" as VaultStatus, hasValue: true,
          };
        }
        if (inEnv) {
          return {
            key, ref: entry.ref ?? null, description: entry.description ?? null,
            storage: "encrypted",
            required: entry.required ?? false,
            status: "env-only" as VaultStatus, hasValue: true,
          };
        }
        return {
          key, ref: entry.ref ?? null, description: entry.description ?? null,
          storage: "encrypted",
          required: entry.required ?? false,
          status: "unresolved" as VaultStatus, hasValue: false,
          error: "encrypted local secret is missing",
        };
      } catch (e) {
        return {
          key, ref: entry.ref ?? null, description: entry.description ?? null,
          storage: "encrypted",
          required: entry.required ?? false,
          status: "error" as VaultStatus, hasValue: false,
          error: e instanceof Error ? e.message : "unknown error",
        };
      }
    }

    if (inEnv) {
      return {
        key, ref: entry.ref ?? null, description: entry.description ?? null,
        storage: entry.storage ?? (entry.ref ? "1password" : null),
        required: entry.required ?? false,
        status: "env-only" as VaultStatus, hasValue: true,
      };
    }

    if (!entry.ref) {
      return {
        key, ref: null, description: entry.description ?? null,
        storage: entry.storage ?? null,
        required: entry.required ?? false,
        status: "no-ref" as VaultStatus, hasValue: false,
      };
    }

    try {
      const value = opRead(entry.ref);
      if (value) {
        process.env[key] = value; // cache
        return {
          key, ref: entry.ref, description: entry.description ?? null,
          storage: "1password",
          required: entry.required ?? false,
          status: "resolved" as VaultStatus, hasValue: true,
        };
      }
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        storage: "1password",
        required: entry.required ?? false,
        status: "unresolved" as VaultStatus, hasValue: false,
        error: "op read returned empty — check ref or 1Password auth",
      };
    } catch (e) {
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        storage: "1password",
        required: entry.required ?? false,
        status: "error" as VaultStatus, hasValue: false,
        error: e instanceof Error ? e.message : "unknown error",
      };
    }
  });
}
