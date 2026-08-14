import type { CaveConfig } from "../cave-config.ts";

/**
 * Shared familiar-id guard for routes that interpolate `id` into a filesystem
 * path (e.g. `familiarWorkspace(id)`). Constraining the id to a strict slug —
 * alphanumerics plus `_`/`-`, no path separator, no `..` — keeps those routes
 * from becoming arbitrary-directory-read primitives. Callers MUST gate on this
 * before touching the filesystem; helpers re-assert it as an inline barrier.
 */
const VALID_FAMILIAR_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isValidFamiliarId(id: string): boolean {
  // The regex already excludes `/`, `\`, and `.`, so `..` is impossible; the
  // explicit check documents the invariant for readers and static analysis.
  return VALID_FAMILIAR_ID.test(id) && !id.includes("..");
}

export type ExactFamiliarIdResolution =
  | { ok: true; familiarId: string }
  | { ok: false; reason: "unknown" | "alias" | "collision" };

/**
 * Admit a familiar id only when the request names one authoritative id byte for
 * byte. Case folding is used solely to detect aliases; it never canonicalizes
 * caller input. This matters on case-insensitive filesystems (and on Linux when
 * a case-variant symlink exists): `WREN` must not inherit defaults while
 * resolving the workspace owned by `wren`.
 */
export function resolveExactFamiliarId(
  requestedId: string,
  authoritativeIds: readonly string[],
): ExactFamiliarIdResolution {
  if (!isValidFamiliarId(requestedId)) return { ok: false, reason: "unknown" };

  const exactIds = new Set(authoritativeIds.filter(isValidFamiliarId));
  const foldedRequested = requestedId.toLowerCase();
  const aliases = [...exactIds].filter((id) => id.toLowerCase() === foldedRequested);
  if (aliases.length > 1) return { ok: false, reason: "collision" };
  if (!exactIds.has(requestedId)) {
    return { ok: false, reason: aliases.length === 1 ? "alias" : "unknown" };
  }
  return { ok: true, familiarId: requestedId };
}

type FamiliarIdentityDependencies = {
  loadDeclaredIds(): Promise<readonly string[]>;
  loadRosterIds(config: CaveConfig): Promise<readonly string[] | null>;
};

const DEFAULT_IDENTITY_DEPENDENCIES: FamiliarIdentityDependencies = {
  async loadDeclaredIds() {
    const [{ readFile }, path, { covenHome }, { parseFamiliarsToml }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
      import("../coven-paths.ts"),
      import("../onboarding-familiars.ts"),
    ]);
    try {
      const encoded = await readFile(path.join(covenHome(), "familiars.toml"), "utf8");
      return parseFamiliarsToml(encoded).map((entry) => entry.id);
    } catch {
      return [];
    }
  },
  async loadRosterIds(config) {
    try {
      const { loadVisibleFamiliarRoster } = await import("./familiar-roster.ts");
      const result = await loadVisibleFamiliarRoster(config);
      return result.ok ? result.roster.map((entry) => entry.id) : null;
    } catch {
      return null;
    }
  },
};

/**
 * Resolve the request against local durable identity first. Local config and
 * familiars.toml remain usable while the daemon is offline; only an id with no
 * local case-fold match consults the live roster for hub-only familiars.
 */
export async function resolveAuthoritativeFamiliarId(
  config: CaveConfig,
  requestedId: string,
  dependencies: FamiliarIdentityDependencies = DEFAULT_IDENTITY_DEPENDENCIES,
): Promise<ExactFamiliarIdResolution> {
  const declaredIds = await dependencies.loadDeclaredIds();
  const local = resolveExactFamiliarId(requestedId, [
    ...Object.keys(config.familiars),
    ...declaredIds,
  ]);
  if (local.ok || local.reason !== "unknown") return local;

  const rosterIds = await dependencies.loadRosterIds(config);
  if (rosterIds === null) return local;
  return resolveExactFamiliarId(requestedId, rosterIds);
}
