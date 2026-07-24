import { FONT_OPTIONS } from "./font-catalog.ts";
import { THEME_IDS } from "./theme-palettes.ts";

/**
 * Port-independent, non-secret UI preferences owned by the Cave sidecar.
 *
 * Keep credentials, access tokens, provider keys, and workspace secrets out of
 * this schema. Unknown properties are rejected at the API boundary and dropped
 * while recovering a file written by an older/newer build.
 */

export const CAVE_PREFERENCES_VERSION = 1 as const;

export type CaveMode = "light" | "dark";
export type CaveModePreference = CaveMode | "system";
export type CaveThemeId = (typeof THEME_IDS)[number] | "custom";

export type CustomThemeData = {
  name: string;
  cssVars: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
};

export type CaveThemePreferences = {
  id: CaveThemeId;
  modePreference: CaveModePreference;
  /** Resolved mode shared with clients that do not understand "system". */
  resolvedMode: CaveMode;
  custom: CustomThemeData | null;
  /** Resolved sRGB tokens consumed by the native iOS client. */
  tokens: Record<string, string>;
  /** Changes only when the selected theme/mode/custom data changes. */
  selectionRevision: number;
  updatedAt: string;
};

export type CaveFontPreferences = {
  serif: string;
  sans: string;
  mono: string;
};

export type CaveReadingPreferences = {
  leading: "compact" | "normal" | "relaxed";
  tracking: "normal" | "wide" | "wider";
  align: "left" | "justify";
  width: "full" | "medium" | "narrow";
  weight: "light" | "normal" | "medium";
  hyphens: "off" | "on";
};

export type CaveDateTimePreferences = {
  clock: "12h" | "24h";
  date: "mmdd" | "ddmm" | "off";
  density: "compact" | "verbose";
};

export type CaveBackdropAccentSeed = { L: number; a: number; b: number };

export type CaveBackdropImageMetadata = {
  present: boolean;
  mime: "image/jpeg" | "image/png" | "image/webp" | null;
  updatedAt: string;
};

/** Backdrop style option set — grows as animated styles land (cave-99s9). */
export const BACKDROP_STYLES = ["image", "blaze"] as const;
export type CaveBackdropStyle = (typeof BACKDROP_STYLES)[number];

export type CaveBackdropPreferences = {
  enabled: boolean;
  intensity: number;
  matchAccent: boolean;
  accentSeed: CaveBackdropAccentSeed | null;
  /** Which visual fills the layer: the stored image or the Blaze effect. */
  style: CaveBackdropStyle;
  /** Explicit per-familiar enablement (cave-kf8p); absent id = image-presence default. */
  familiars: Record<string, boolean>;
  image: CaveBackdropImageMetadata;
};

export type CavePreferences = {
  version: typeof CAVE_PREFERENCES_VERSION;
  /** False means the server has no canonical file yet; legacy storage may seed it. */
  initialized: boolean;
  revision: number;
  updatedAt: string;
  appearance: {
    theme: CaveThemePreferences;
    fonts: CaveFontPreferences;
    screenScale: 100 | 110 | 125 | 150;
    reading: CaveReadingPreferences;
    datetime: CaveDateTimePreferences;
    recentColors: string[];
    cornerRadius: "sharp" | "default" | "round";
    backdrop: CaveBackdropPreferences;
  };
  general: {
    newsHeadlines: boolean;
    /**
     * Comma-separated composer phrases, any of which halts a running chat
     * task; "" disables the feature.
     */
    stopPhrase: string;
    /**
     * Progression celebrations — milestone toasts and completion flourishes.
     * Off keeps milestones inbox-only and stills the flourishes; the tool
     * stays clean and fast for users who ignore the whole system.
     */
    celebrations: boolean;
  };
  phone: {
    mobileMode: boolean;
  };
};

export type CavePreferencesPatch = {
  appearance?: {
    theme?: Partial<Pick<CaveThemePreferences, "id" | "modePreference" | "resolvedMode" | "custom" | "tokens">>;
    fonts?: Partial<CaveFontPreferences>;
    screenScale?: CavePreferences["appearance"]["screenScale"];
    reading?: Partial<CaveReadingPreferences>;
    datetime?: Partial<CaveDateTimePreferences>;
    recentColors?: string[];
    cornerRadius?: CavePreferences["appearance"]["cornerRadius"];
    backdrop?: Partial<Omit<CaveBackdropPreferences, "image">> & {
      image?: Partial<CaveBackdropImageMetadata>;
    };
  };
  general?: Partial<CavePreferences["general"]>;
  phone?: Partial<CavePreferences["phone"]>;
};

const DEFAULT_THEME: CaveThemePreferences = {
  id: "coven",
  modePreference: "dark",
  resolvedMode: "dark",
  custom: null,
  tokens: {},
  selectionRevision: 0,
  updatedAt: "",
};

/**
 * Default composer stop phrases (comma-separated options); "" (after trim)
 * turns the feature off.
 */
export const DEFAULT_STOP_PHRASE = "stop, cancel, halt, abort";
/** Longest phrase list the preference stores; UI and matcher share this bound. */
export const STOP_PHRASE_MAX_LENGTH = 160;

function normalizeStopPhrase(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_STOP_PHRASE;
  return value.trim().slice(0, STOP_PHRASE_MAX_LENGTH);
}

export function createDefaultPreferences(initialized = false): CavePreferences {
  return {
    version: CAVE_PREFERENCES_VERSION,
    initialized,
    revision: 0,
    updatedAt: "",
    appearance: {
      theme: { ...DEFAULT_THEME, tokens: {} },
      fonts: { serif: "eb-garamond", sans: "inter", mono: "jetbrains-mono" },
      screenScale: 100,
      reading: {
        leading: "normal",
        tracking: "normal",
        align: "left",
        width: "full",
        weight: "normal",
        hyphens: "off",
      },
      datetime: { clock: "12h", date: "mmdd", density: "compact" },
      recentColors: [],
      cornerRadius: "default",
      backdrop: {
        enabled: false,
        intensity: 50,
        matchAccent: true,
        accentSeed: null,
        style: "image",
        familiars: {},
        image: { present: false, mime: null, updatedAt: "" },
      },
    },
    general: { newsHeadlines: true, stopPhrase: DEFAULT_STOP_PHRASE, celebrations: true },
    phone: { mobileMode: true },
  };
}

export class PreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferencesValidationError";
  }
}

type UnknownRecord = Record<string, unknown>;

const LEGACY_THEME_RENAME: Record<string, CaveThemeId> = {
  "mood-c": "coven",
  sky: "tide",
  orchid: "dusk",
  midnight: "slate",
  openai: "codex",
};

const THEME_ID_SET = new Set<string>([...THEME_IDS, "custom"]);
const FONT_IDS_BY_SLOT = {
  serif: new Set(FONT_OPTIONS.filter((option) => option.slot === "serif").map((option) => option.id)),
  sans: new Set(FONT_OPTIONS.filter((option) => option.slot === "sans").map((option) => option.id)),
  mono: new Set(FONT_OPTIONS.filter((option) => option.slot === "mono").map((option) => option.id)),
};
const SCREEN_SCALES = [100, 110, 125, 150] as const;
const MODE_PREFERENCES = ["light", "dark", "system"] as const;
const MODES = ["light", "dark"] as const;
const READING_LEADING = ["compact", "normal", "relaxed"] as const;
const READING_TRACKING = ["normal", "wide", "wider"] as const;
const READING_ALIGN = ["left", "justify"] as const;
const READING_WIDTH = ["full", "medium", "narrow"] as const;
const READING_WEIGHT = ["light", "normal", "medium"] as const;
const READING_HYPHENS = ["off", "on"] as const;
const CLOCK_FORMATS = ["12h", "24h"] as const;
const DATE_FORMATS = ["mmdd", "ddmm", "off"] as const;
const DENSITY_FORMATS = ["compact", "verbose"] as const;
const CORNER_RADII = ["sharp", "default", "round"] as const;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const CSS_VAR_RE = /^(?:--)?[a-zA-Z0-9_-]{1,80}$/;
const MAX_THEME_TOKENS = 256;
export const MAX_FAMILIAR_BACKDROPS = 256;
const MAX_FAMILIAR_BACKDROP_KEY_LENGTH = 128;
const MAX_CSS_VALUE_LENGTH = 512;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function oneOf<T extends readonly (string | number)[]>(
  value: unknown,
  choices: T,
  fallback: T[number],
): T[number] {
  return choices.includes(value as never) ? (value as T[number]) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function timestamp(value: unknown): string {
  return typeof value === "string" && (value === "" || Number.isFinite(Date.parse(value))) ? value : "";
}

function normalizeThemeId(value: unknown): CaveThemeId {
  if (typeof value !== "string") return "coven";
  const renamed = LEGACY_THEME_RENAME[value] ?? value;
  return THEME_ID_SET.has(renamed) ? (renamed as CaveThemeId) : "coven";
}

function normalizeCssGroup(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined;
  const output: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input).slice(0, MAX_THEME_TOKENS)) {
    if (!CSS_VAR_RE.test(rawName) || typeof value !== "string" || value.length > MAX_CSS_VALUE_LENGTH) continue;
    output[rawName] = value;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function sanitizeCustomTheme(input: unknown): CustomThemeData | null {
  if (!isRecord(input)) return null;
  const cssVars = record(input.cssVars);
  const theme = normalizeCssGroup(cssVars.theme);
  const light = normalizeCssGroup(cssVars.light);
  const dark = normalizeCssGroup(cssVars.dark);
  if (!theme && !light && !dark) return null;
  const rawName = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  return {
    name: rawName || "Custom",
    cssVars: {
      ...(theme ? { theme } : {}),
      ...(light ? { light } : {}),
      ...(dark ? { dark } : {}),
    },
  };
}

export function sanitizeThemeTokens(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input).slice(0, MAX_THEME_TOKENS)) {
    if (!name.startsWith("--") || !CSS_VAR_RE.test(name)) continue;
    if (typeof value !== "string" || value.length > MAX_CSS_VALUE_LENGTH) continue;
    output[name] = value;
  }
  return output;
}

function normalizeAccentSeed(input: unknown): CaveBackdropAccentSeed | null {
  if (!isRecord(input)) return null;
  const { L, a, b } = input;
  if (
    typeof L !== "number" || !Number.isFinite(L) || L < 0 || L > 1 ||
    typeof a !== "number" || !Number.isFinite(a) || Math.abs(a) > 1 ||
    typeof b !== "number" || !Number.isFinite(b) || Math.abs(b) > 1
  ) return null;
  return { L, a, b };
}

function normalizeFamiliarBackdrops(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    // "__proto__" is skipped: assigning it on a plain object would hit the
    // legacy prototype setter instead of creating an entry, and the slug
    // alphabet ([a-z0-9-]) can never produce it as a real familiar id.
    if (key !== "" && key !== "__proto__" && key.length <= MAX_FAMILIAR_BACKDROP_KEY_LENGTH && typeof entry === "boolean") {
      if (Object.keys(out).length >= MAX_FAMILIAR_BACKDROPS) break;
      out[key] = entry;
    }
  }
  return out;
}

export function normalizeCavePreferences(input: unknown): CavePreferences {
  const source = record(input);
  const appearance = record(source.appearance);
  const theme = record(appearance.theme);
  const fonts = record(appearance.fonts);
  const reading = record(appearance.reading);
  const datetime = record(appearance.datetime);
  const backdrop = record(appearance.backdrop);
  const image = record(backdrop.image);
  const general = record(source.general);
  const phone = record(source.phone);

  const modePreference = oneOf(theme.modePreference, MODE_PREFERENCES, "dark");
  const resolvedMode = oneOf(
    theme.resolvedMode,
    MODES,
    modePreference === "light" || modePreference === "dark" ? modePreference : "dark",
  );
  const imageMime: CaveBackdropImageMetadata["mime"] =
    typeof image.mime === "string" && (IMAGE_MIMES as readonly string[]).includes(image.mime)
      ? image.mime as CaveBackdropImageMetadata["mime"]
      : null;

  return {
    version: CAVE_PREFERENCES_VERSION,
    initialized: source.initialized === true,
    revision: nonNegativeInteger(source.revision),
    updatedAt: timestamp(source.updatedAt),
    appearance: {
      theme: {
        id: normalizeThemeId(theme.id),
        modePreference,
        resolvedMode,
        custom: sanitizeCustomTheme(theme.custom),
        tokens: sanitizeThemeTokens(theme.tokens),
        selectionRevision: nonNegativeInteger(theme.selectionRevision),
        updatedAt: timestamp(theme.updatedAt),
      },
      fonts: {
        serif: typeof fonts.serif === "string" && FONT_IDS_BY_SLOT.serif.has(fonts.serif)
          ? fonts.serif : "eb-garamond",
        sans: typeof fonts.sans === "string" && FONT_IDS_BY_SLOT.sans.has(fonts.sans)
          ? fonts.sans : "inter",
        mono: typeof fonts.mono === "string" && FONT_IDS_BY_SLOT.mono.has(fonts.mono)
          ? fonts.mono : "jetbrains-mono",
      },
      screenScale: oneOf(appearance.screenScale, SCREEN_SCALES, 100),
      reading: {
        leading: oneOf(reading.leading, READING_LEADING, "normal"),
        tracking: oneOf(reading.tracking, READING_TRACKING, "normal"),
        align: oneOf(reading.align, READING_ALIGN, "left"),
        width: oneOf(reading.width, READING_WIDTH, "full"),
        weight: oneOf(reading.weight, READING_WEIGHT, "normal"),
        hyphens: oneOf(reading.hyphens, READING_HYPHENS, "off"),
      },
      datetime: {
        clock: oneOf(datetime.clock, CLOCK_FORMATS, "12h"),
        date: oneOf(datetime.date, DATE_FORMATS, "mmdd"),
        density: oneOf(datetime.density, DENSITY_FORMATS, "compact"),
      },
      recentColors: Array.isArray(appearance.recentColors)
        ? appearance.recentColors
          .filter((value): value is string => typeof value === "string" && HEX_COLOR_RE.test(value))
          .map((value) => value.toLowerCase())
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 6)
        : [],
      cornerRadius: oneOf(appearance.cornerRadius, CORNER_RADII, "default"),
      backdrop: {
        enabled: backdrop.enabled === true,
        intensity: typeof backdrop.intensity === "number" && Number.isFinite(backdrop.intensity)
          ? Math.min(100, Math.max(0, backdrop.intensity)) : 50,
        matchAccent: backdrop.matchAccent !== false,
        accentSeed: normalizeAccentSeed(backdrop.accentSeed),
        style: oneOf(backdrop.style, BACKDROP_STYLES, "image"),
        familiars: normalizeFamiliarBackdrops(backdrop.familiars),
        image: {
          present: image.present === true,
          mime: imageMime,
          updatedAt: timestamp(image.updatedAt),
        },
      },
    },
    general: {
      newsHeadlines: general.newsHeadlines !== false,
      stopPhrase: normalizeStopPhrase(general.stopPhrase),
      celebrations: general.celebrations !== false,
    },
    phone: { mobileMode: phone.mobileMode !== false },
  };
}

function fail(path: string, message: string): never {
  throw new PreferencesValidationError(`${path} ${message}`);
}

function strictRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail(path, "must be an object");
  return value;
}

function assertAllowedKeys(value: UnknownRecord, allowed: readonly string[], path: string): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) fail(`${path}.${key}`, "is not a supported preference");
  }
}

function strictChoice<T extends readonly (string | number)[]>(
  value: unknown,
  choices: T,
  path: string,
): T[number] {
  if (!choices.includes(value as never)) fail(path, `must be one of ${choices.join(", ")}`);
  return value as T[number];
}

function strictBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function strictTokens(value: unknown, path: string): Record<string, string> {
  const input = strictRecord(value, path);
  const entries = Object.entries(input);
  if (entries.length > MAX_THEME_TOKENS) fail(path, `may contain at most ${MAX_THEME_TOKENS} tokens`);
  const output: Record<string, string> = {};
  for (const [name, token] of entries) {
    if (!name.startsWith("--") || !CSS_VAR_RE.test(name)) fail(`${path}.${name}`, "is not a CSS variable name");
    if (typeof token !== "string" || token.length > MAX_CSS_VALUE_LENGTH) {
      fail(`${path}.${name}`, `must be a string of at most ${MAX_CSS_VALUE_LENGTH} characters`);
    }
    output[name] = token;
  }
  return output;
}

function strictCssGroup(value: unknown, path: string): Record<string, string> {
  const input = strictRecord(value, path);
  const entries = Object.entries(input);
  if (entries.length > MAX_THEME_TOKENS) fail(path, `may contain at most ${MAX_THEME_TOKENS} variables`);
  const output: Record<string, string> = {};
  for (const [name, cssValue] of entries) {
    if (!CSS_VAR_RE.test(name)) fail(`${path}.${name}`, "is not a CSS variable name");
    if (typeof cssValue !== "string" || cssValue.length > MAX_CSS_VALUE_LENGTH) {
      fail(`${path}.${name}`, `must be a string of at most ${MAX_CSS_VALUE_LENGTH} characters`);
    }
    output[name] = cssValue;
  }
  return output;
}

function strictCustomTheme(value: unknown, path: string): CustomThemeData | null {
  if (value === null) return null;
  const input = strictRecord(value, path);
  assertAllowedKeys(input, ["name", "cssVars"], path);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) {
    fail(`${path}.name`, "must be a non-empty string of at most 120 characters");
  }
  const cssVars = strictRecord(input.cssVars, `${path}.cssVars`);
  assertAllowedKeys(cssVars, ["theme", "light", "dark"], `${path}.cssVars`);
  const result: CustomThemeData["cssVars"] = {};
  for (const group of ["theme", "light", "dark"] as const) {
    if (Object.hasOwn(cssVars, group)) result[group] = strictCssGroup(cssVars[group], `${path}.cssVars.${group}`);
  }
  if (Object.keys(result).length === 0) fail(`${path}.cssVars`, "must contain a theme, light, or dark group");
  return { name: input.name.trim(), cssVars: result };
}

function strictAccentSeed(value: unknown, path: string): CaveBackdropAccentSeed | null {
  if (value === null) return null;
  const input = strictRecord(value, path);
  assertAllowedKeys(input, ["L", "a", "b"], path);
  const { L, a, b } = input;
  if (typeof L !== "number" || !Number.isFinite(L) || L < 0 || L > 1) fail(`${path}.L`, "must be between 0 and 1");
  if (typeof a !== "number" || !Number.isFinite(a) || Math.abs(a) > 1) fail(`${path}.a`, "must be between -1 and 1");
  if (typeof b !== "number" || !Number.isFinite(b) || Math.abs(b) > 1) fail(`${path}.b`, "must be between -1 and 1");
  return { L, a, b };
}

export function validatePreferencesPatch(value: unknown): CavePreferencesPatch {
  const input = strictRecord(value, "preferences patch");
  assertAllowedKeys(input, ["appearance", "general", "phone"], "preferences patch");
  const patch: CavePreferencesPatch = {};

  if (Object.hasOwn(input, "appearance")) {
    const appearance = strictRecord(input.appearance, "appearance");
    assertAllowedKeys(
      appearance,
      ["theme", "fonts", "screenScale", "reading", "datetime", "recentColors", "cornerRadius", "backdrop"],
      "appearance",
    );
    const next: NonNullable<CavePreferencesPatch["appearance"]> = {};

    if (Object.hasOwn(appearance, "theme")) {
      const theme = strictRecord(appearance.theme, "appearance.theme");
      assertAllowedKeys(theme, ["id", "modePreference", "resolvedMode", "custom", "tokens"], "appearance.theme");
      const themePatch: NonNullable<typeof next.theme> = {};
      if (Object.hasOwn(theme, "id")) {
        if (typeof theme.id !== "string" || !THEME_ID_SET.has(theme.id)) fail("appearance.theme.id", "is not a known theme");
        themePatch.id = theme.id as CaveThemeId;
      }
      if (Object.hasOwn(theme, "modePreference")) {
        themePatch.modePreference = strictChoice(theme.modePreference, MODE_PREFERENCES, "appearance.theme.modePreference");
      }
      if (Object.hasOwn(theme, "resolvedMode")) {
        themePatch.resolvedMode = strictChoice(theme.resolvedMode, MODES, "appearance.theme.resolvedMode");
      }
      if (Object.hasOwn(theme, "custom")) themePatch.custom = strictCustomTheme(theme.custom, "appearance.theme.custom");
      if (Object.hasOwn(theme, "tokens")) themePatch.tokens = strictTokens(theme.tokens, "appearance.theme.tokens");
      next.theme = themePatch;
    }

    if (Object.hasOwn(appearance, "fonts")) {
      const fonts = strictRecord(appearance.fonts, "appearance.fonts");
      assertAllowedKeys(fonts, ["serif", "sans", "mono"], "appearance.fonts");
      const fontPatch: Partial<CaveFontPreferences> = {};
      for (const slot of ["serif", "sans", "mono"] as const) {
        if (!Object.hasOwn(fonts, slot)) continue;
        if (typeof fonts[slot] !== "string" || !FONT_IDS_BY_SLOT[slot].has(fonts[slot])) {
          fail(`appearance.fonts.${slot}`, `is not a known ${slot} font`);
        }
        fontPatch[slot] = fonts[slot];
      }
      next.fonts = fontPatch;
    }

    if (Object.hasOwn(appearance, "screenScale")) {
      next.screenScale = strictChoice(appearance.screenScale, SCREEN_SCALES, "appearance.screenScale");
    }
    if (Object.hasOwn(appearance, "reading")) {
      const reading = strictRecord(appearance.reading, "appearance.reading");
      assertAllowedKeys(reading, ["leading", "tracking", "align", "width", "weight", "hyphens"], "appearance.reading");
      next.reading = {
        ...(Object.hasOwn(reading, "leading") ? { leading: strictChoice(reading.leading, READING_LEADING, "appearance.reading.leading") } : {}),
        ...(Object.hasOwn(reading, "tracking") ? { tracking: strictChoice(reading.tracking, READING_TRACKING, "appearance.reading.tracking") } : {}),
        ...(Object.hasOwn(reading, "align") ? { align: strictChoice(reading.align, READING_ALIGN, "appearance.reading.align") } : {}),
        ...(Object.hasOwn(reading, "width") ? { width: strictChoice(reading.width, READING_WIDTH, "appearance.reading.width") } : {}),
        ...(Object.hasOwn(reading, "weight") ? { weight: strictChoice(reading.weight, READING_WEIGHT, "appearance.reading.weight") } : {}),
        ...(Object.hasOwn(reading, "hyphens") ? { hyphens: strictChoice(reading.hyphens, READING_HYPHENS, "appearance.reading.hyphens") } : {}),
      };
    }
    if (Object.hasOwn(appearance, "datetime")) {
      const datetime = strictRecord(appearance.datetime, "appearance.datetime");
      assertAllowedKeys(datetime, ["clock", "date", "density"], "appearance.datetime");
      next.datetime = {
        ...(Object.hasOwn(datetime, "clock") ? { clock: strictChoice(datetime.clock, CLOCK_FORMATS, "appearance.datetime.clock") } : {}),
        ...(Object.hasOwn(datetime, "date") ? { date: strictChoice(datetime.date, DATE_FORMATS, "appearance.datetime.date") } : {}),
        ...(Object.hasOwn(datetime, "density") ? { density: strictChoice(datetime.density, DENSITY_FORMATS, "appearance.datetime.density") } : {}),
      };
    }
    if (Object.hasOwn(appearance, "recentColors")) {
      if (!Array.isArray(appearance.recentColors) || appearance.recentColors.length > 6) {
        fail("appearance.recentColors", "must be an array of at most 6 colors");
      }
      const colors = appearance.recentColors.map((value, index) => {
        if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
          fail(`appearance.recentColors.${index}`, "must be a #rrggbb color");
        }
        return value.toLowerCase();
      });
      if (new Set(colors).size !== colors.length) fail("appearance.recentColors", "must not contain duplicates");
      next.recentColors = colors;
    }
    if (Object.hasOwn(appearance, "cornerRadius")) {
      next.cornerRadius = strictChoice(appearance.cornerRadius, CORNER_RADII, "appearance.cornerRadius");
    }
    if (Object.hasOwn(appearance, "backdrop")) {
      const backdrop = strictRecord(appearance.backdrop, "appearance.backdrop");
      assertAllowedKeys(backdrop, ["enabled", "intensity", "matchAccent", "accentSeed", "style", "familiars", "image"], "appearance.backdrop");
      const backdropPatch: NonNullable<typeof next.backdrop> = {};
      if (Object.hasOwn(backdrop, "enabled")) backdropPatch.enabled = strictBoolean(backdrop.enabled, "appearance.backdrop.enabled");
      if (Object.hasOwn(backdrop, "intensity")) {
        if (typeof backdrop.intensity !== "number" || !Number.isFinite(backdrop.intensity) || backdrop.intensity < 0 || backdrop.intensity > 100) {
          fail("appearance.backdrop.intensity", "must be between 0 and 100");
        }
        backdropPatch.intensity = backdrop.intensity;
      }
      if (Object.hasOwn(backdrop, "matchAccent")) backdropPatch.matchAccent = strictBoolean(backdrop.matchAccent, "appearance.backdrop.matchAccent");
      if (Object.hasOwn(backdrop, "accentSeed")) backdropPatch.accentSeed = strictAccentSeed(backdrop.accentSeed, "appearance.backdrop.accentSeed");
      if (Object.hasOwn(backdrop, "style")) {
        backdropPatch.style = strictChoice(backdrop.style, BACKDROP_STYLES, "appearance.backdrop.style");
      }
      if (Object.hasOwn(backdrop, "familiars")) {
        const familiars = strictRecord(backdrop.familiars, "appearance.backdrop.familiars");
        if (Object.keys(familiars).length > MAX_FAMILIAR_BACKDROPS) {
          fail("appearance.backdrop.familiars", `must not exceed ${MAX_FAMILIAR_BACKDROPS} entries`);
        }
        const map: Record<string, boolean> = {};
        for (const [key, entry] of Object.entries(familiars)) {
          // "__proto__" is rejected: it can't be a slugged familiar id, and
          // assigning it on a plain object would silently drop the entry.
          if (key === "" || key === "__proto__" || key.length > MAX_FAMILIAR_BACKDROP_KEY_LENGTH) {
            fail("appearance.backdrop.familiars", "keys must be valid familiar ids");
          }
          map[key] = strictBoolean(entry, `appearance.backdrop.familiars.${key}`);
        }
        backdropPatch.familiars = map;
      }
      if (Object.hasOwn(backdrop, "image")) {
        const image = strictRecord(backdrop.image, "appearance.backdrop.image");
        assertAllowedKeys(image, ["present", "mime", "updatedAt"], "appearance.backdrop.image");
        const imagePatch: Partial<CaveBackdropImageMetadata> = {};
        if (Object.hasOwn(image, "present")) imagePatch.present = strictBoolean(image.present, "appearance.backdrop.image.present");
        if (Object.hasOwn(image, "mime")) {
          if (image.mime !== null && !IMAGE_MIMES.includes(image.mime as never)) fail("appearance.backdrop.image.mime", "is not supported");
          imagePatch.mime = image.mime as CaveBackdropImageMetadata["mime"];
        }
        if (Object.hasOwn(image, "updatedAt")) {
          if (typeof image.updatedAt !== "string" || (image.updatedAt !== "" && !Number.isFinite(Date.parse(image.updatedAt)))) {
            fail("appearance.backdrop.image.updatedAt", "must be an ISO timestamp");
          }
          imagePatch.updatedAt = image.updatedAt;
        }
        backdropPatch.image = imagePatch;
      }
      next.backdrop = backdropPatch;
    }
    patch.appearance = next;
  }

  if (Object.hasOwn(input, "general")) {
    const general = strictRecord(input.general, "general");
    assertAllowedKeys(general, ["newsHeadlines", "stopPhrase", "celebrations"], "general");
    const generalPatch: NonNullable<CavePreferencesPatch["general"]> = {};
    if (Object.hasOwn(general, "newsHeadlines")) {
      generalPatch.newsHeadlines = strictBoolean(general.newsHeadlines, "general.newsHeadlines");
    }
    if (Object.hasOwn(general, "celebrations")) {
      generalPatch.celebrations = strictBoolean(general.celebrations, "general.celebrations");
    }
    if (Object.hasOwn(general, "stopPhrase")) {
      if (typeof general.stopPhrase !== "string") fail("general.stopPhrase", "must be a string");
      generalPatch.stopPhrase = normalizeStopPhrase(general.stopPhrase);
    }
    patch.general = generalPatch;
  }
  if (Object.hasOwn(input, "phone")) {
    const phone = strictRecord(input.phone, "phone");
    assertAllowedKeys(phone, ["mobileMode"], "phone");
    patch.phone = Object.hasOwn(phone, "mobileMode")
      ? { mobileMode: strictBoolean(phone.mobileMode, "phone.mobileMode") }
      : {};
  }

  return patch;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function patchHasValues(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // An explicitly-present empty record is a value: replace-whole-map fields
  // (backdrop.familiars, theme.tokens) clear by sending {}. The semantic
  // jsonEqual guard in applyPreferencesPatch still prevents no-op revisions.
  return Object.entries(value).some(([, child]) =>
    isRecord(child) ? Object.keys(child).length === 0 || patchHasValues(child) : true,
  );
}

/** Apply an already-validated patch and stamp canonical metadata. */
export function applyPreferencesPatch(
  currentInput: CavePreferences,
  patch: CavePreferencesPatch,
  now = new Date(),
): CavePreferences {
  const current = normalizeCavePreferences(currentInput);
  if (!patchHasValues(patch) && current.initialized) return current;

  const appearancePatch = patch.appearance;
  const themePatch = appearancePatch?.theme;
  let nextTheme: CaveThemePreferences = {
    ...current.appearance.theme,
    ...(themePatch ?? {}),
    tokens: themePatch?.tokens ? { ...themePatch.tokens } : current.appearance.theme.tokens,
    custom: themePatch && Object.hasOwn(themePatch, "custom")
      ? (themePatch.custom ?? null)
      : current.appearance.theme.custom,
  };
  if (themePatch?.id && themePatch.id !== "custom" && !Object.hasOwn(themePatch, "custom")) {
    nextTheme = { ...nextTheme, custom: null };
  }
  if (themePatch?.modePreference === "light" || themePatch?.modePreference === "dark") {
    if (!Object.hasOwn(themePatch, "resolvedMode")) nextTheme.resolvedMode = themePatch.modePreference;
  }

  const selectionChanged = Boolean(themePatch) && !jsonEqual(
    {
      id: current.appearance.theme.id,
      modePreference: current.appearance.theme.modePreference,
      custom: current.appearance.theme.custom,
    },
    {
      id: nextTheme.id,
      modePreference: nextTheme.modePreference,
      custom: nextTheme.custom,
    },
  );

  const next: CavePreferences = {
    ...current,
    appearance: {
      ...current.appearance,
      ...(appearancePatch ?? {}),
      theme: nextTheme,
      fonts: { ...current.appearance.fonts, ...(appearancePatch?.fonts ?? {}) },
      reading: { ...current.appearance.reading, ...(appearancePatch?.reading ?? {}) },
      datetime: { ...current.appearance.datetime, ...(appearancePatch?.datetime ?? {}) },
      backdrop: {
        ...current.appearance.backdrop,
        ...(appearancePatch?.backdrop ?? {}),
        image: {
          ...current.appearance.backdrop.image,
          ...(appearancePatch?.backdrop?.image ?? {}),
        },
      },
    },
    general: { ...current.general, ...(patch.general ?? {}) },
    phone: { ...current.phone, ...(patch.phone ?? {}) },
  };

  const semanticCurrent = { ...current, initialized: true, revision: 0, updatedAt: "" };
  const semanticNext = { ...next, initialized: true, revision: 0, updatedAt: "" };
  if (current.initialized && jsonEqual(semanticCurrent, semanticNext)) return current;

  const iso = now.toISOString();
  const revision = current.revision + 1;
  next.initialized = true;
  next.revision = revision;
  next.updatedAt = iso;
  if (themePatch && Object.keys(themePatch).length > 0) {
    next.appearance.theme.updatedAt = iso;
    if (selectionChanged || !current.initialized) next.appearance.theme.selectionRevision = revision;
  }
  return normalizeCavePreferences(next);
}

export const LEGACY_PREFERENCE_STORAGE_KEYS = [
  "coven-theme",
  "coven-mode",
  "coven-custom-theme",
  "coven:recent-colors",
  "cave:font:serif",
  "cave:font:sans",
  "cave:font:mono",
  "cave:screen-scale",
  "cave:reading-leading",
  "cave:reading-tracking",
  "cave:reading-align",
  "cave:reading-width",
  "cave:reading-weight",
  "cave:reading-hyphens",
  "cave:datetime-clock",
  "cave:datetime-date",
  "cave:datetime-density",
  "cave:corner-radius",
  "cave:backdrop:v1",
  "cave:home-news-enabled",
  "cave:mobile-mode-enabled",
] as const;

/** Canonical snapshot represented in the legacy cache keys existing components read. */
export function preferencesToLegacyStorage(input: CavePreferences): Record<string, string> {
  const preferences = normalizeCavePreferences(input);
  const { appearance } = preferences;
  const values: Record<string, string> = {
    "coven-theme": appearance.theme.id,
    "coven-mode": appearance.theme.modePreference,
    "coven:recent-colors": JSON.stringify(appearance.recentColors),
    "cave:font:serif": appearance.fonts.serif,
    "cave:font:sans": appearance.fonts.sans,
    "cave:font:mono": appearance.fonts.mono,
    "cave:screen-scale": String(appearance.screenScale),
    "cave:reading-leading": appearance.reading.leading,
    "cave:reading-tracking": appearance.reading.tracking,
    "cave:reading-align": appearance.reading.align,
    "cave:reading-width": appearance.reading.width,
    "cave:reading-weight": appearance.reading.weight,
    "cave:reading-hyphens": appearance.reading.hyphens,
    "cave:datetime-clock": appearance.datetime.clock,
    "cave:datetime-date": appearance.datetime.date,
    "cave:datetime-density": appearance.datetime.density,
    "cave:corner-radius": appearance.cornerRadius,
    "cave:backdrop:v1": JSON.stringify({
      enabled: appearance.backdrop.enabled,
      intensity: appearance.backdrop.intensity,
      matchAccent: appearance.backdrop.matchAccent,
      accentSeed: appearance.backdrop.accentSeed,
      style: appearance.backdrop.style,
    }),
    "cave:home-news-enabled": String(preferences.general.newsHeadlines),
    "cave:mobile-mode-enabled": String(preferences.phone.mobileMode),
  };
  if (appearance.theme.custom) values["coven-custom-theme"] = JSON.stringify(appearance.theme.custom);
  return values;
}

function storageString(values: Record<string, unknown>, key: string): string | null {
  const value = values[key];
  return typeof value === "string" ? value : null;
}

function parseStoredJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Best-effort migration from the CURRENT origin. Invalid values are ignored;
 * callers should submit this only while the canonical snapshot is uninitialized.
 */
export function legacyStorageToPreferencesPatch(values: Record<string, unknown>): CavePreferencesPatch {
  const appearance: NonNullable<CavePreferencesPatch["appearance"]> = {};
  const theme: NonNullable<typeof appearance.theme> = {};
  const themeIdRaw = storageString(values, "coven-theme");
  if (themeIdRaw) {
    const renamed = LEGACY_THEME_RENAME[themeIdRaw] ?? themeIdRaw;
    if (THEME_ID_SET.has(renamed)) theme.id = renamed as CaveThemeId;
  }
  const modeRaw = storageString(values, "coven-mode");
  if (MODE_PREFERENCES.includes(modeRaw as never)) theme.modePreference = modeRaw as CaveModePreference;
  const custom = sanitizeCustomTheme(parseStoredJson(storageString(values, "coven-custom-theme")));
  if (custom) theme.custom = custom;
  if (Object.keys(theme).length > 0) appearance.theme = theme;

  const fonts: Partial<CaveFontPreferences> = {};
  for (const slot of ["serif", "sans", "mono"] as const) {
    const value = storageString(values, `cave:font:${slot}`);
    if (value && FONT_IDS_BY_SLOT[slot].has(value)) fonts[slot] = value;
  }
  if (Object.keys(fonts).length > 0) appearance.fonts = fonts;

  const scale = Number(storageString(values, "cave:screen-scale"));
  if (SCREEN_SCALES.includes(scale as never)) appearance.screenScale = scale as CavePreferences["appearance"]["screenScale"];

  const reading: Partial<CaveReadingPreferences> = {};
  const readingValues = {
    leading: ["cave:reading-leading", READING_LEADING],
    tracking: ["cave:reading-tracking", READING_TRACKING],
    align: ["cave:reading-align", READING_ALIGN],
    width: ["cave:reading-width", READING_WIDTH],
    weight: ["cave:reading-weight", READING_WEIGHT],
    hyphens: ["cave:reading-hyphens", READING_HYPHENS],
  } as const;
  for (const key of Object.keys(readingValues) as Array<keyof CaveReadingPreferences>) {
    const [storageKey, choices] = readingValues[key];
    const value = storageString(values, storageKey);
    if ((choices as readonly string[]).includes(value ?? "")) {
      (reading as Record<string, string>)[key] = value!;
    }
  }
  if (Object.keys(reading).length > 0) appearance.reading = reading;

  const datetime: Partial<CaveDateTimePreferences> = {};
  const clock = storageString(values, "cave:datetime-clock");
  const date = storageString(values, "cave:datetime-date");
  const density = storageString(values, "cave:datetime-density");
  if (CLOCK_FORMATS.includes(clock as never)) datetime.clock = clock as CaveDateTimePreferences["clock"];
  if (DATE_FORMATS.includes(date as never)) datetime.date = date as CaveDateTimePreferences["date"];
  if (DENSITY_FORMATS.includes(density as never)) datetime.density = density as CaveDateTimePreferences["density"];
  if (Object.keys(datetime).length > 0) appearance.datetime = datetime;

  const recentColors = parseStoredJson(storageString(values, "coven:recent-colors"));
  if (Array.isArray(recentColors)) {
    const normalized = recentColors
      .filter((value): value is string => typeof value === "string" && HEX_COLOR_RE.test(value))
      .map((value) => value.toLowerCase())
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 6);
    if (normalized.length > 0) appearance.recentColors = normalized;
  }

  const radius = storageString(values, "cave:corner-radius");
  if (CORNER_RADII.includes(radius as never)) appearance.cornerRadius = radius as CavePreferences["appearance"]["cornerRadius"];

  const backdropRaw = parseStoredJson(storageString(values, "cave:backdrop:v1"));
  if (isRecord(backdropRaw)) {
    const backdrop: NonNullable<typeof appearance.backdrop> = {};
    if (typeof backdropRaw.enabled === "boolean") backdrop.enabled = backdropRaw.enabled;
    if (typeof backdropRaw.intensity === "number" && Number.isFinite(backdropRaw.intensity)) {
      backdrop.intensity = Math.min(100, Math.max(0, backdropRaw.intensity));
    }
    if (typeof backdropRaw.matchAccent === "boolean") backdrop.matchAccent = backdropRaw.matchAccent;
    const accentSeed = normalizeAccentSeed(backdropRaw.accentSeed);
    if (accentSeed) backdrop.accentSeed = accentSeed;
    if (typeof backdropRaw.style === "string" && BACKDROP_STYLES.includes(backdropRaw.style as never)) {
      backdrop.style = backdropRaw.style as CaveBackdropStyle;
    }
    if (Object.keys(backdrop).length > 0) appearance.backdrop = backdrop;
  }

  const patch: CavePreferencesPatch = {};
  if (Object.keys(appearance).length > 0) patch.appearance = appearance;
  const news = storageString(values, "cave:home-news-enabled");
  if (news === "true" || news === "false") patch.general = { newsHeadlines: news !== "false" };
  const mobile = storageString(values, "cave:mobile-mode-enabled");
  if (mobile === "true" || mobile === "false") patch.phone = { mobileMode: mobile !== "false" };
  return patch;
}
