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
 * The vault.yaml mapping declares which backend a key uses: when it carries a
 * ref (and is not declared `storage: "encrypted"`), the ref wins — a stale or
 * orphaned entry left behind in the local encrypted store must never shadow it.
 *
 * Resolved values are cached in process.env for the lifetime of the process
 * so subsequent calls are instant. The raw secret value is NEVER written to
 * any file — it lives only in process memory.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { caveHome } from "./coven-paths.ts";
import { readEnvLocalAll, readEnvLocalValue } from "./env-file.ts";
import { getLocalEncryptedSecret, hasLocalEncryptedSecret } from "./local-encrypted-vault.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultEntry = {
  ref?: string;
  storage?: "1password" | "encrypted" | "dashlane";
  description?: string;
  required?: boolean;
};

export type VaultMap = Record<string, VaultEntry>;

export type VaultStatus = "resolved" | "configured" | "encrypted" | "env-only" | "unresolved" | "error" | "no-ref";

export type VaultMappingStatus = {
  key: string;
  ref: string | null;
  storage: "1password" | "encrypted" | "dashlane" | null;
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
 * under `caveHome()`, seeded once from the bundle's shipped map.
 *
 * Resolution (first hit wins): `COVEN_VAULT_FILE` → bundle path → `<cwd>/vault.yaml`.
 */
function vaultYamlPath(): string {
  const override = process.env.COVEN_VAULT_FILE?.trim();
  if (override) return override;
  if (isBundle()) return join(caveHome(), "vault.yaml");
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

// Apps launched from Finder/Spotlight inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so a CLI installed under Homebrew or the
// user's local bin — where `op` (and other resolver CLIs) typically live — is
// not found, and every reference silently resolves to "unresolved" in packaged
// builds even when the CLI is installed and authenticated. Augment PATH with
// the well-known install locations before spawning, so resolution works the
// same in a packaged app as it does when launched from a shell.
function resolverEnv(): NodeJS.ProcessEnv {
  const home = homedir();
  const candidates = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, "bin"),
  ];
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const merged = [...current, ...candidates.filter((dir) => !current.includes(dir))];
  return { ...process.env, PATH: merged.join(delimiter) };
}

/** Call `op read` to fetch a secret reference. Returns null on failure. */
function opRead(ref: string): string | null {
  if (validateOpRef(ref)) return null;

  try {
    const value = execFileSync("op", ["read", ref], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 8000,
      env: resolverEnv(),
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

// ── dashlane (dcli) resolver ────────────────────────────────────────────────
// Dashlane's CLI mirrors 1Password's model: a scheme-prefixed reference read
// through a local, authenticated CLI. `dcli read dl://<id-or-title>/<field>`.
// Which backend a mapping uses is carried entirely by the ref scheme, so the
// resolver/status paths dispatch on the prefix — no extra persisted metadata.
const DL_REF_PREFIX = "dl://";

export function validateDashlaneRef(ref: unknown): string | null {
  if (typeof ref !== "string") return "ref must be a string";
  if (!ref.startsWith(DL_REF_PREFIX)) return "ref must start with dl://";
  if (ref.length > OP_REF_MAX_LENGTH) return "ref is too long";
  if (OP_REF_FORBIDDEN_CHARS.test(ref)) return "ref contains invalid characters";

  const path = ref.slice(DL_REF_PREFIX.length).split("?")[0];
  const segments = path.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment.trim())) {
    return "ref must include a secret id/title and a field, e.g. dl://GitHub PAT/username";
  }

  return null;
}

/** Call `dcli read` to fetch a Dashlane secret reference. Returns null on failure. */
function dcliRead(ref: string): string | null {
  if (validateDashlaneRef(ref)) return null;

  try {
    const value = execFileSync("dcli", ["read", ref], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 8000,
      env: resolverEnv(),
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

/** The storage backend a reference resolves through, implied by its scheme. */
export function refStorage(ref: string): "1password" | "dashlane" {
  return ref.startsWith(DL_REF_PREFIX) ? "dashlane" : "1password";
}

/** Validate a secret reference, dispatching by scheme (op:// vs dl://). */
export function validateRef(ref: unknown): string | null {
  return typeof ref === "string" && ref.startsWith(DL_REF_PREFIX)
    ? validateDashlaneRef(ref)
    : validateOpRef(ref);
}

/** Resolve a secret reference via the appropriate CLI, dispatching by scheme. */
function readRef(ref: string): string | null {
  return ref.startsWith(DL_REF_PREFIX) ? dcliRead(ref) : opRead(ref);
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

  // The map's declared backend wins: a ref mapping is never shadowed by a
  // stale/orphaned entry in the local encrypted store. Unmapped encrypted
  // secrets (no entry at all) still resolve.
  const preferEncrypted =
    entry?.storage === "encrypted" || (!entry?.ref && hasLocalEncryptedSecret(key));
  const localEncrypted = preferEncrypted ? getLocalEncryptedSecret(key) : null;
  if (localEncrypted?.trim()) {
    process.env[key] = localEncrypted.trim();
    return localEncrypted.trim();
  }

  // Try a vault reference (1Password op:// or Dashlane dl://)
  if (!entry?.ref) return undefined;

  const value = readRef(entry.ref);
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
    // A ref mapping reports its ref backend even if an orphaned encrypted
    // entry lingers in the local store (cave-6iee).
    const hasEncrypted = entry.storage === "encrypted" || (!entry.ref && hasLocalEncryptedSecret(key));

    if (inEnv) {
      return {
        key, ref: entry.ref ?? null, description: entry.description ?? null,
        storage: entry.storage ?? (entry.ref ? refStorage(entry.ref) : null),
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
        storage: refStorage(entry.ref),
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

    // Same backend-priority rule as resolveSecret: an orphaned encrypted
    // entry must not make a ref mapping report (or resolve) as "encrypted".
    if (entry.storage === "encrypted" || (!entry.ref && hasLocalEncryptedSecret(key))) {
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
        storage: entry.storage ?? (entry.ref ? refStorage(entry.ref) : null),
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
      const value = readRef(entry.ref);
      if (value) {
        process.env[key] = value; // cache
        return {
          key, ref: entry.ref, description: entry.description ?? null,
          storage: refStorage(entry.ref),
          required: entry.required ?? false,
          status: "resolved" as VaultStatus, hasValue: true,
        };
      }
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        storage: refStorage(entry.ref),
        required: entry.required ?? false,
        status: "unresolved" as VaultStatus, hasValue: false,
        error: refStorage(entry.ref) === "dashlane"
          ? "dcli read returned empty — check ref or Dashlane auth (dcli sync)"
          : "op read returned empty — check ref or 1Password auth",
      };
    } catch (e) {
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        storage: refStorage(entry.ref),
        required: entry.required ?? false,
        status: "error" as VaultStatus, hasValue: false,
        error: e instanceof Error ? e.message : "unknown error",
      };
    }
  });
}
