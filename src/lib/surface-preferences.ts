"use client";

import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from "react";

/** A single, versioned home for durable Workspace navigation preferences. */
export const SURFACE_PREFERENCES_STORAGE_KEY = "cave:surface-preferences:v1";
const STORE_VERSION = 1;

type RawPreferences = Record<string, unknown>;

type StoredSurfacePreferences = {
  version: number;
  values: RawPreferences;
};

export type SurfacePreferenceSpec<T> = {
  /** Stable, namespaced key such as `github.organization`. */
  key: string;
  defaultValue: T;
  /** Return undefined for malformed, stale, or otherwise unsupported stored input. */
  parse: (value: unknown) => T | undefined;
};

type PreferencesContextValue = {
  values: RawPreferences;
  setValues: Dispatch<SetStateAction<RawPreferences>>;
  hydrated: boolean;
};

const SurfacePreferencesContext = createContext<PreferencesContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the storage payload defensively. A version mismatch deliberately
 * starts from defaults so a future schema can migrate without trusting old
 * shapes.
 */
export function readSurfacePreferences(storage: Pick<Storage, "getItem"> | null): RawPreferences {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SURFACE_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !isRecord(parsed.values)) return {};
    return parsed.values;
  } catch {
    return {};
  }
}

export function writeSurfacePreferences(storage: Pick<Storage, "setItem"> | null, values: RawPreferences): void {
  if (!storage) return;
  const payload: StoredSurfacePreferences = { version: STORE_VERSION, values };
  try {
    storage.setItem(SURFACE_PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage is an enhancement; quota/privacy failures must not break navigation.
  }
}

/**
 * One-time compatibility bridge for the narrow set of preferences that used
 * to live in individual localStorage keys. The new registry always wins, so
 * this cannot overwrite a choice already saved by this system.
 */
export function readLegacySurfacePreferences(storage: Pick<Storage, "getItem"> | null): RawPreferences {
  if (!storage) return {};
  const read = (key: string) => {
    try { return storage.getItem(key); } catch { return null; }
  };
  const values: RawPreferences = {};
  const copy = (legacyKey: string, preferenceKey: string) => {
    const value = read(legacyKey);
    if (value !== null) values[preferenceKey] = value;
  };
  copy("cave:board:viewMode", "board.viewMode");
  copy("cave:board:groupBy", "board.groupBy");
  copy("cave:board:ganttGroup", "board.ganttGroup");
  copy("cave:agents.lastSelected", "familiars.selectedId");
  copy("cave:inbox:group-by", "schedules.groupBy");
  const familiarFilter = read("cave:automations:familiar-filter");
  if (familiarFilter) {
    try {
      const parsed: unknown = JSON.parse(familiarFilter);
      values["schedules.familiarFilter"] = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string").sort().join(",")
        : familiarFilter;
    } catch {
      values["schedules.familiarFilter"] = familiarFilter;
    }
  }
  return values;
}

/**
 * Keeps durable values alive above conditionally-mounted Workspace surfaces and
 * mirrors the approved subset to localStorage after client hydration.
 */
export function WorkspaceSurfacePreferencesProvider({ children }: PropsWithChildren) {
  const [values, setValues] = useState<RawPreferences>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const current = readSurfacePreferences(window.localStorage);
    setValues({ ...readLegacySurfacePreferences(window.localStorage), ...current });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeSurfacePreferences(window.localStorage, values);
  }, [hydrated, values]);

  const contextValue = useMemo(
    () => ({ values, setValues, hydrated }),
    [values, hydrated],
  );

  return createElement(SurfacePreferencesContext.Provider, { value: contextValue }, children);
}

/**
 * Field-level API used by a surface. Preferences are opt-in: callers only get
 * persistence for fields with an explicit spec and validator.
 */
export function useSurfacePreference<T>(spec: SurfacePreferenceSpec<T>): [T, (next: SetStateAction<T>) => void, boolean] {
  const context = useContext(SurfacePreferencesContext);
  const rawValue = context?.values[spec.key];
  const parsed = rawValue === undefined ? undefined : spec.parse(rawValue);
  const value = parsed === undefined ? spec.defaultValue : parsed;

  // Invalid persisted values must not linger forever. Delete only the invalid
  // field so sibling preferences remain intact.
  useEffect(() => {
    if (!context?.hydrated || rawValue === undefined || parsed !== undefined) return;
    context.setValues((current) => {
      if (!(spec.key in current)) return current;
      const { [spec.key]: _discarded, ...rest } = current;
      return rest;
    });
  }, [context, parsed, rawValue, spec.key]);

  const setValue = useCallback((next: SetStateAction<T>) => {
    if (!context) return;
    context.setValues((current) => {
      const currentParsed = current[spec.key] === undefined ? undefined : spec.parse(current[spec.key]);
      const base = currentParsed === undefined ? spec.defaultValue : currentParsed;
      const candidate = typeof next === "function" ? (next as (previous: T) => T)(base) : next;
      const normalized = spec.parse(candidate);
      if (normalized === undefined) return current;
      return { ...current, [spec.key]: normalized };
    });
  }, [context, spec]);

  return [value, setValue, context?.hydrated ?? false];
}
