import type {
  CaveMode,
  CaveModePreference,
  CavePreferences,
  CaveThemePreferences,
  CustomThemeData,
} from "./preferences-schema.ts";

type ThemeRoot = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  style: {
    removeProperty(name: string): string;
    setProperty(name: string, value: string): void;
  };
};

function cssName(name: string): string {
  return name.startsWith("--") ? name : `--${name}`;
}

/** Resolve an explicit choice, or the current OS choice when following system. */
export function resolveThemeMode(
  theme: Pick<CaveThemePreferences, "modePreference">,
  systemDark: boolean,
): CaveMode {
  if (theme.modePreference === "light" || theme.modePreference === "dark") {
    return theme.modePreference;
  }
  return systemDark ? "dark" : "light";
}

/** Every property a custom theme may have installed, across both modes. */
export function customThemeVariableNames(custom: CustomThemeData | null): string[] {
  if (!custom) return [];
  const names = new Set<string>();
  for (const group of [custom.cssVars.theme, custom.cssVars.light, custom.cssVars.dark]) {
    if (!group) continue;
    for (const name of Object.keys(group)) names.add(cssName(name));
  }
  return [...names];
}

/** Mode-agnostic variables followed by the selected (or only available) mode. */
export function activeCustomThemeVariables(
  custom: CustomThemeData | null,
  mode: CaveMode,
): Record<string, string> {
  if (!custom) return {};
  const modeGroup =
    (mode === "light" ? custom.cssVars.light : custom.cssVars.dark) ??
    (mode === "light" ? custom.cssVars.dark : custom.cssVars.light);
  const variables: Record<string, string> = {};
  for (const group of [custom.cssVars.theme, modeGroup]) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      variables[cssName(name)] = value;
    }
  }
  return variables;
}

/**
 * Apply one canonical theme snapshot to the root element.
 *
 * The caller supplies the last custom theme it actually applied. That matters
 * when a refresh has already replaced the in-memory canonical snapshot: using
 * the new snapshot to decide what to clear would strand variables owned only
 * by the old custom theme.
 */
export function applyThemeToRoot(
  root: ThemeRoot,
  theme: Pick<CaveThemePreferences, "id" | "custom">,
  mode: CaveMode,
  previousCustom: CustomThemeData | null,
): void {
  for (const name of customThemeVariableNames(previousCustom)) {
    root.style.removeProperty(name);
  }
  root.setAttribute("data-theme", theme.id);
  root.setAttribute("data-mode", mode);
  if (theme.id !== "custom") return;
  for (const [name, value] of Object.entries(activeCustomThemeVariables(theme.custom, mode))) {
    root.style.setProperty(name, value);
  }
}

/** Stable identity for the part of preferences that changes rendered theme CSS. */
export function themeRuntimeSignature(
  theme: Pick<CaveThemePreferences, "id" | "custom">,
  mode: CaveMode,
): string {
  return JSON.stringify([theme.id, mode, theme.id === "custom" ? theme.custom : null]);
}

export type RemoteThemeVersion = {
  themeId?: string;
  mode?: string;
  modePreference?: string;
  revision?: number;
  selectionRevision?: number;
};

/**
 * Whether a polled compatibility snapshot warrants a canonical refresh.
 * A lower selection revision is always stale, even if unrelated writes gave
 * that response a higher global revision.
 */
export function remoteThemeNeedsRefresh(
  remote: RemoteThemeVersion,
  local: Pick<CavePreferences, "revision" | "appearance">,
): boolean {
  const selectionRevision = Number(remote.selectionRevision ?? 0);
  const localTheme = local.appearance.theme;
  if (!Number.isSafeInteger(selectionRevision) || selectionRevision < 0) return false;
  if (selectionRevision < localTheme.selectionRevision) return false;
  const modePreference = remote.modePreference as CaveModePreference | undefined;
  const canonicalDiffers =
    remote.themeId !== localTheme.id ||
    remote.mode !== localTheme.resolvedMode ||
    modePreference !== localTheme.modePreference;
  return (
    selectionRevision > localTheme.selectionRevision ||
    (Number.isSafeInteger(remote.revision) && Number(remote.revision) > local.revision) ||
    canonicalDiffers
  );
}
