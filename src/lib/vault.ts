/**
 * Cave Vault — resolves env vars from 1Password secret references
 *
 * vault.yaml maps ENV_VAR_NAME → { ref: "op://Vault/Item/field", ... }
 *
 * Resolution priority:
 *   1. Already in process.env (e.g. set by .env.local or OS env) → use as-is
 *   2. vault.yaml has a ref for this key → resolve via `op read`
 *   3. undefined
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultEntry = {
  ref: string;
  description?: string;
  required?: boolean;
};

export type VaultMap = Record<string, VaultEntry>;

export type VaultStatus = "resolved" | "env-only" | "unresolved" | "error" | "no-ref";

export type VaultMappingStatus = {
  key: string;
  ref: string | null;
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
    "# Cave Vault — env var → 1Password secret reference map",
    "#",
    "# Format:",
    '#   ENV_VAR_NAME:',
    '#     ref: "op://VaultName/ItemTitle/field"',
    '#     description: "human-readable note"',
    "#     required: false",
    "#",
    "# Secrets are NEVER stored here — only the op:// reference.",
    "# Safe to commit; contains no credentials.",
    "",
  ];
  for (const [key, entry] of Object.entries(map)) {
    lines.push(`${key}:`);
    lines.push(`  ref: "${entry.ref}"`);
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
 * Checks process.env first, then vault.yaml → `op read`.
 * Caches in process.env on success.
 * Never logs or persists the value to disk.
 */
export function resolveSecret(key: string): string | undefined {
  // Already in env (set via OS, .env.local, or prior resolve)
  if (process.env[key]?.trim()) return process.env[key]!.trim();

  // Try vault
  const map = loadVaultMap();
  const entry = map[key];
  if (!entry?.ref) return undefined;

  const value = opRead(entry.ref);
  if (value) {
    process.env[key] = value; // cache for process lifetime
    return value;
  }
  return undefined;
}

/** Check if a key is resolvable without returning the value. */
export function canResolve(key: string): boolean {
  return !!resolveSecret(key);
}

// ── Status reporter (for /api/vault UI) ──────────────────────────────────────

export function getVaultStatuses(): VaultMappingStatus[] {
  const map = loadVaultMap(true); // always fresh for status checks
  return Object.entries(map).map(([key, entry]) => {
    const inEnv = !!(process.env[key]?.trim());

    if (inEnv) {
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        required: entry.required ?? false,
        status: "env-only" as VaultStatus, hasValue: true,
      };
    }

    if (!entry.ref) {
      return {
        key, ref: null, description: entry.description ?? null,
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
          required: entry.required ?? false,
          status: "resolved" as VaultStatus, hasValue: true,
        };
      }
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        required: entry.required ?? false,
        status: "unresolved" as VaultStatus, hasValue: false,
        error: "op read returned empty — check ref or 1Password auth",
      };
    } catch (e) {
      return {
        key, ref: entry.ref, description: entry.description ?? null,
        required: entry.required ?? false,
        status: "error" as VaultStatus, hasValue: false,
        error: e instanceof Error ? e.message : "unknown error",
      };
    }
  });
}
