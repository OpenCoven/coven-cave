export const VAULT_STORAGE_IDS = [
  "encrypted",
  "1password",
  "dashlane",
  "environment",
] as const;

export type VaultStorageId = (typeof VAULT_STORAGE_IDS)[number];

export type VaultStorageProvider = {
  id: VaultStorageId;
  label: string;
  shortLabel: string;
  description: string;
  referencePrefix: string | null;
  acceptsValue: boolean;
};

export const VAULT_STORAGE_PROVIDERS: readonly VaultStorageProvider[] = [
  {
    id: "encrypted",
    label: "Local encrypted",
    shortLabel: "Encrypted",
    description: "Paste a value. Cave encrypts it with this machine's local Vault key.",
    referencePrefix: null,
    acceptsValue: true,
  },
  {
    id: "1password",
    label: "1Password",
    shortLabel: "1Password",
    description: "Store an op:// reference and resolve it through the authenticated 1Password CLI.",
    referencePrefix: "op://",
    acceptsValue: true,
  },
  {
    id: "dashlane",
    label: "Dashlane",
    shortLabel: "Dashlane",
    description: "Store a dl:// reference and resolve it through the authenticated Dashlane CLI.",
    referencePrefix: "dl://",
    acceptsValue: true,
  },
  {
    id: "environment",
    label: "Environment",
    shortLabel: "Environment",
    description: "Use a value already supplied by the launcher or writable .env.local file.",
    referencePrefix: null,
    acceptsValue: false,
  },
] as const;

export const VAULT_PASTE_MAX_ENTRIES = 50;
export const VAULT_PASTE_MAX_VALUE_LENGTH = 65_536;

const ENV_ASSIGNMENT_PATTERN =
  /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function normalizeVaultKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export function vaultStorageProvider(
  storage: VaultStorageId,
): VaultStorageProvider {
  return VAULT_STORAGE_PROVIDERS.find((provider) => provider.id === storage)
    ?? VAULT_STORAGE_PROVIDERS[0];
}

export function vaultStorageForValue(value: string): Exclude<
  VaultStorageId,
  "environment"
> {
  const trimmed = value.trim();
  if (trimmed.startsWith("op://")) return "1password";
  if (trimmed.startsWith("dl://")) return "dashlane";
  return "encrypted";
}

export function vaultStorageForReference(
  ref: string,
): "1password" | "dashlane" {
  return ref.trim().startsWith("dl://") ? "dashlane" : "1password";
}

export type ParsedVaultPasteEntry = {
  key: string;
  storage: "encrypted" | "1password" | "dashlane";
  value?: string;
  ref?: string;
};

export type VaultPasteResult = {
  entries: ParsedVaultPasteEntry[];
  error: string | null;
  assignmentMode: boolean;
};

function unquoteEnvValue(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function parsedEntry(key: string, rawValue: string): ParsedVaultPasteEntry {
  const value = unquoteEnvValue(rawValue.trim());
  const storage = vaultStorageForValue(value);
  return storage === "encrypted"
    ? { key, storage, value }
    : { key, storage, ref: value };
}

function validateParsedEntries(
  entries: ParsedVaultPasteEntry[],
): string | null {
  if (entries.length > VAULT_PASTE_MAX_ENTRIES) {
    return `Paste at most ${VAULT_PASTE_MAX_ENTRIES} secrets at once.`;
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.key) return "Every pasted secret needs an environment variable name.";
    const value = entry.storage === "encrypted" ? entry.value : entry.ref;
    if (!value) return `${entry.key} needs a value or secure reference.`;
    if (value.length > VAULT_PASTE_MAX_VALUE_LENGTH) {
      return `${entry.key} is too large to store in the Vault.`;
    }
    if (seen.has(entry.key)) return `${entry.key} appears more than once.`;
    seen.add(entry.key);
  }
  return null;
}

export function parseVaultPaste(
  input: string,
  fallbackKey = "",
): VaultPasteResult {
  const meaningfulLines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (meaningfulLines.length === 0) {
    return { entries: [], error: null, assignmentMode: false };
  }

  const assignments = meaningfulLines.map((line) => line.match(ENV_ASSIGNMENT_PATTERN));
  const assignmentMode = assignments.some((match) => match !== null);

  if (assignmentMode) {
    if (assignments.some((match) => match === null)) {
      return {
        entries: [],
        error: "Paste one KEY=value assignment per line.",
        assignmentMode: true,
      };
    }
    const entries = assignments.map((match) =>
      parsedEntry(normalizeVaultKey(match![1]), match![2]));
    return {
      entries,
      error: validateParsedEntries(entries),
      assignmentMode: true,
    };
  }

  const key = normalizeVaultKey(fallbackKey);
  const entries = [parsedEntry(key, input.trim())];
  return {
    entries,
    error: validateParsedEntries(entries),
    assignmentMode: false,
  };
}
