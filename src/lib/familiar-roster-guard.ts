export const INTERNAL_COVEN_FAMILIAR_IDS = new Set([
  "nova",
  "kitty",
  "cody",
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

export function filterInstallSeedFamiliars<T extends FamiliarRosterEntry>(
  familiars: readonly T[],
  explicitIdsInput: ReadonlySet<string> | readonly string[],
): T[] {
  if (familiars.length === 0) return [];
  const explicitIds = Array.isArray(explicitIdsInput)
    ? new Set(explicitIdsInput.map(normalizeId))
    : new Set(Array.from(explicitIdsInput, normalizeId));

  if (familiars.every(isInstallDefaultFamiliar)) return [];

  return familiars.filter((familiar) => {
    const id = normalizeId(familiar.id);
    const explicit = explicitIds.has(id);
    if (isInstallDefaultFamiliar(familiar) && !explicit) return false;
    if (INTERNAL_COVEN_FAMILIAR_IDS.has(id) && !explicit) return false;
    if (isInternalCovenFamiliarName(familiar.display_name ?? "") && !explicit) return false;
    return true;
  });
}
