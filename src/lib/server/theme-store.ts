import {
  sanitizeThemeTokens,
  type CaveMode,
  type CaveModePreference,
  type CavePreferences,
  type CaveThemeId,
  type CustomThemeData,
} from "@/lib/preferences-schema";
import {
  PreferencesConflictError,
  loadPreferences,
  updatePreferences,
} from "@/lib/server/preferences-store";

/** Backward-compatible shape decoded by the existing native iOS app. */
export type ThemeSnapshot = {
  themeId: string;
  mode: CaveMode;
  tokens: Record<string, string>;
  updatedAt: string;
  revision: number;
  selectionRevision: number;
  modePreference: CaveModePreference;
  custom: CustomThemeData | null;
};

export type ThemeSaveInput = {
  themeId?: unknown;
  mode?: unknown;
  modePreference?: unknown;
  resolvedMode?: unknown;
  custom?: unknown;
  tokens?: unknown;
  tokenOnly?: unknown;
  expectedSelectionRevision?: unknown;
};

export function themeSnapshotFromPreferences(preferences: CavePreferences): ThemeSnapshot {
  const theme = preferences.appearance.theme;
  return {
    themeId: theme.id,
    mode: theme.resolvedMode,
    tokens: { ...theme.tokens },
    updatedAt: theme.updatedAt,
    revision: preferences.revision,
    selectionRevision: theme.selectionRevision,
    modePreference: theme.modePreference,
    custom: theme.custom,
  };
}

export async function loadTheme(): Promise<ThemeSnapshot> {
  return themeSnapshotFromPreferences(await loadPreferences());
}

function expectedSelectionRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function modePreference(input: ThemeSaveInput, current: CavePreferences): CaveModePreference {
  if (input.modePreference === "light" || input.modePreference === "dark" || input.modePreference === "system") {
    return input.modePreference;
  }
  if (input.mode === "light" || input.mode === "dark") return input.mode;
  return current.appearance.theme.modePreference;
}

function resolvedMode(input: ThemeSaveInput, preference: CaveModePreference, current: CavePreferences): CaveMode {
  if (input.resolvedMode === "light" || input.resolvedMode === "dark") return input.resolvedMode;
  if (input.mode === "light" || input.mode === "dark") return input.mode;
  if (preference === "light" || preference === "dark") return preference;
  return current.appearance.theme.resolvedMode;
}

export async function saveTheme(input: ThemeSaveInput): Promise<ThemeSnapshot> {
  const tokenOnly = input.tokenOnly === true;
  const expected = expectedSelectionRevision(input.expectedSelectionRevision);
  const preferences = await updatePreferences((current) => {
    if (tokenOnly && expected === null) {
      throw new TypeError("expectedSelectionRevision required for token-only theme updates");
    }
    if (expected !== null && expected !== current.appearance.theme.selectionRevision) {
      throw new PreferencesConflictError("theme selection changed", current);
    }

    if (tokenOnly) {
      return {
        appearance: {
          theme: {
            tokens: sanitizeThemeTokens(input.tokens),
            ...(input.resolvedMode === "light" || input.resolvedMode === "dark"
              ? { resolvedMode: input.resolvedMode }
              : {}),
          },
        },
      };
    }

    if (typeof input.themeId !== "string" || !input.themeId) {
      throw new TypeError("themeId required");
    }
    const preference = modePreference(input, current);
    const mode = resolvedMode(input, preference, current);
    const selectionChanged =
      input.themeId !== current.appearance.theme.id ||
      preference !== current.appearance.theme.modePreference ||
      (Object.hasOwn(input, "custom") && JSON.stringify(input.custom) !== JSON.stringify(current.appearance.theme.custom));
    const hasTokens = Object.hasOwn(input, "tokens");
    return {
      appearance: {
        theme: {
          id: input.themeId as CaveThemeId,
          modePreference: preference,
          resolvedMode: mode,
          custom: input.themeId === "custom"
            ? (Object.hasOwn(input, "custom") ? input.custom as CustomThemeData | null : current.appearance.theme.custom)
            : null,
          tokens: hasTokens
            ? sanitizeThemeTokens(input.tokens)
            : selectionChanged ? {} : current.appearance.theme.tokens,
        },
      },
    };
  });
  return themeSnapshotFromPreferences(preferences);
}
