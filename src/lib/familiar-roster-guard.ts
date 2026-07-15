export const INTERNAL_COVEN_FAMILIAR_IDS = new Set([
  "nova",
  "kitty",
  "cody",
  "charm",
  "sage",
  "astra",
  "echo",
  "salem",
]);

const INSTALL_DEFAULT_FAMILIARS: ReadonlyMap<string, { displayName: string; role: string }> = new Map(
  [
    ["sage", { displayName: "Sage", role: "Guide" }],
    ["forge", { displayName: "Forge", role: "Builder" }],
    ["opencode-local", { displayName: "OpenCode", role: "Code Familiar" }],
  ] as const,
);

type FamiliarRosterEntry = {
  id: string;
  display_name?: string | null;
  role?: string | null;
  last_seen?: string | null;
  active_sessions?: number | null;
  memory_freshness?: string | null;
};

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function slugName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isInternalCovenFamiliarName(value: string): boolean {
  return INTERNAL_COVEN_FAMILIAR_IDS.has(slugName(value));
}

export function filterInternalCovenNameSuggestions<T extends string>(names: readonly T[]): T[] {
  return names.filter((name) => !isInternalCovenFamiliarName(name));
}

export function explicitFamiliarIdsFromToml(toml: string): Set<string> {
  const ids = new Set<string>();
  for (const line of toml.split(/\r?\n/)) {
    const match = line.match(/^\s*id\s*=\s*"([^"]+)"\s*$/);
    if (match) ids.add(normalizeId(match[1] ?? ""));
  }
  ids.delete("");
  return ids;
}

function isInstallDefaultFamiliar(familiar: FamiliarRosterEntry): boolean {
  const signature = INSTALL_DEFAULT_FAMILIARS.get(normalizeId(familiar.id));
  if (!signature) return false;
  const displayName = normalizeName(familiar.display_name);
  const role = normalizeName(familiar.role);
  return (
    (!displayName || displayName === normalizeName(signature.displayName)) &&
    (!role || role === normalizeName(signature.role))
  );
}

/**
 * Evidence that a roster entry is a real, living familiar rather than a
 * daemon-seeded suggestion: seeded defaults carry only id/name/role, while a
 * familiar that has actually run has activity fields. A coven can genuinely
 * contain a familiar named Sage or Salem (on this machine or a remote host),
 * so live entries are exempt from every name-based hide heuristic below.
 */
export function hasLiveFamiliarState(familiar: FamiliarRosterEntry): boolean {
  return Boolean(
    (familiar.last_seen ?? "").trim() ||
      (familiar.memory_freshness ?? "").trim() ||
      (typeof familiar.active_sessions === "number" && familiar.active_sessions > 0),
  );
}

export function filterInstallSeedFamiliars<T extends FamiliarRosterEntry>(
  familiars: readonly T[],
  explicitIdsInput: ReadonlySet<string> | readonly string[],
): T[] {
  if (familiars.length === 0) return [];
  const explicitIds = Array.isArray(explicitIdsInput)
    ? new Set(explicitIdsInput.map(normalizeId))
    : new Set(Array.from(explicitIdsInput, normalizeId));

  return familiars.filter((familiar) => {
    if (hasLiveFamiliarState(familiar)) return true;
    const id = normalizeId(familiar.id);
    const explicit = explicitIds.has(id);
    if (isInstallDefaultFamiliar(familiar) && !explicit) return false;
    if (INTERNAL_COVEN_FAMILIAR_IDS.has(id) && !explicit) return false;
    if (isInternalCovenFamiliarName(familiar.display_name ?? "") && !explicit) return false;
    return true;
  });
}
