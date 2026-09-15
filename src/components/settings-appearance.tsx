"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { SettingsGroup } from "@/components/ui/settings-group";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingControlRow, Segmented } from "@/components/ui/settings-controls";
import { THEME_IDS, THEME_META, getSwatches, type ThemeId } from "@/lib/theme-palettes";
import type { Mode, ModePref } from "@/lib/theme-storage";
import { ModeToggle } from "@/components/mode-toggle";
import { ColorPicker, type ColorSwatch } from "@/components/ui/color-picker";
import { Popover } from "@/components/ui/popover";
import { addRecentColor, getRecentColors } from "@/lib/recent-colors";
import { rgbaBytesToHex } from "@/lib/theme-token-hex";
import { FontSettings } from "./settings-fonts";
import { SettingsTabbed } from "./settings-section-tabs";
import type { TabItem } from "@/components/ui/tabs";
import { CORNER_RADIUS_OPTIONS, CORNER_RADIUS_LABELS, applyCornerRadius, readCornerRadius, type CornerRadius } from "@/lib/appearance-corner-radius";
import { readableTextColor } from "@/lib/readable-text-color";
import { openExternalUrl } from "@/lib/open-external";
import { BackdropSettings } from "@/components/backdrop-settings";
import { flushAppPreferences, readAppPreferences, refreshAppPreferences, subscribeAppPreferences, updateAppPreferences } from "@/lib/app-preferences";
import { clearCustomThemeVariables, reapplyIndependentAppearance } from "@/lib/appearance-restore";
import type { CustomThemeData } from "@/lib/preferences-schema";
import { showSettingsSavedAfterPreferencesFlush, showSettingsSavedToast } from "@/lib/settings-save-feedback";

import { SettingsPage } from "./settings-layout";

// ─── Theme helpers ───────────────────────────────────────────────────────────────────────

type PresetTheme = ThemeId;
type ActiveTheme = PresetTheme | "custom";

function applyPreset(theme: PresetTheme) {
  const html = document.documentElement;
  clearCustomThemeVariables();
  html.setAttribute("data-theme", theme);
  updateAppPreferences({ appearance: { theme: { id: theme, custom: null } } });
  reapplyIndependentAppearance();
}

function resolveMode(pref: ModePref): Mode {
  if (pref === "light" || pref === "dark") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyMode(pref: ModePref) {
  const html = document.documentElement;
  const resolvedMode = resolveMode(pref);
  html.setAttribute("data-mode", resolvedMode);
  updateAppPreferences({ appearance: { theme: { modePreference: pref, resolvedMode } } });
}

// Color tokens mirrored to the daemon so other clients (e.g. the iOS app over
// Tailscale) can match the desktop theme via GET /api/theme.
const THEME_SYNC_KEYS = [
  "--bg-base", "--bg-raised", "--bg-elevated",
  "--text-primary", "--text-secondary", "--text-muted",
  "--border-hairline", "--accent-presence",
] as const;

/**
 * Resolve any CSS colour string to plain sRGB hex by *rasterising* it: paint the
 * colour onto a 1×1 canvas and read the pixel back. `getComputedStyle` hands
 * back a custom property's *authored* value (`lab(...)`, `oklch(...)`,
 * `color-mix(...)`), which a hex-only client (iOS `Color(hex:)`) can't read.
 *
 * NB: reading `ctx.fillStyle` back does NOT down-convert — modern engines keep
 * `lab()`/`oklch()` there (CSS Color 4). Painting forces conversion into the
 * canvas's sRGB backing store, so `getImageData` yields real sRGB bytes. Falls
 * back to the raw value if the context is unavailable or the read throws, so a
 * token is never made worse than it is today.
 */
function resolveTokenToHex(ctx: CanvasRenderingContext2D | null, raw: string): string {
  if (!ctx) return raw;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return rgbaBytesToHex(r, g, b, a);
  } catch {
    return raw;
  }
}

/** Resolve a set of the active theme's tokens from computed style to hex. */
function resolveTokens(keys: readonly string[]): Record<string, string> {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tokens: Record<string, string> = {};
  for (const key of keys) {
    const value = cs.getPropertyValue(key).trim();
    if (value) tokens[key] = resolveTokenToHex(ctx, value);
  }
  return tokens;
}

/** Read the active theme's 8 synced tokens, resolved to hex. */
function resolveSyncTokens(): Record<string, string> {
  return resolveTokens(THEME_SYNC_KEYS);
}

/** Push the active theme + resolved tokens to the daemon for cross-device sync.
 *  Manual Resync only. Change-driven publishing belongs to RemoteThemeController:
 *  every selection/edit here lands in updateAppPreferences, whose store notify
 *  runs the controller's reconcile → publish. A second on-change PUT from this
 *  section raced it — identical payloads plus a 409 window (cave-gvtw). */
async function persistThemeTokens(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!(await flushAppPreferences())) return false;
  try {
    const preferences = readAppPreferences();
    const res = await fetch("/api/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokenOnly: true,
        tokens: resolveSyncTokens(),
        expectedSelectionRevision: preferences.appearance.theme.selectionRevision,
      }),
    });
    if (!res.ok) {
      if (res.status === 409) await refreshAppPreferences();
      return false;
    }
    await refreshAppPreferences();
    return true;
  } catch {
    return false; // best-effort sync; never block the UI
  }
}

function applyCustomVars(cssVars: CustomThemeData["cssVars"], mode: Mode) {
  const html = document.documentElement;
  clearCustomThemeVariables();
  html.setAttribute("data-theme", "custom");

  const apply = (group?: Record<string, string>) => {
    if (!group) return;
    for (const [name, value] of Object.entries(group)) {
      if (typeof value !== "string" || !name) continue;
      const cssName = name.startsWith("--") ? name : `--${name}`;
      html.style.setProperty(cssName, value);
    }
  };
  // theme: mode-agnostic vars (fonts, radius, shadows, tracking).
  // light/dark: mode-specific colors. Fall back to the opposite group
  // when the import only ships one mode.
  apply(cssVars.theme);
  const modeGroup =
    (mode === "light" ? cssVars.light : cssVars.dark) ??
    (mode === "light" ? cssVars.dark : cssVars.light);
  apply(modeGroup);
  reapplyIndependentAppearance({ preserveCustomDefaults: true });
}

/**
 * Translate a tweakcn (shadcn) mode group into the Cave's richer semantic
 * vocabulary.
 *
 * tweakcn ships only shadcn's base tokens — `background`, `foreground`,
 * `primary`, `card`, `popover`, `border`, … The Cave UI, however, is driven
 * mostly by Issue #14 surface/accent tokens. Some of those alias from the base
 * in globals.css and so update for free (`--bg-base: var(--background)`,
 * `--bg-raised: var(--card)`, `--border-hairline: var(--border)`,
 * `--text-primary: var(--foreground)`, `--text-secondary: var(--muted-foreground)`).
 * But the most visible ones are HARDCODED per theme and do NOT alias from the
 * base, so a raw tweakcn import never touches them:
 *   --accent-presence  → every button, focus ring, active state, scrollbar,
 *                        --brand, --ring-focus and --color-info derive from it
 *   --bg-panel         → app shell / sidebar floor
 *   --bg-elevated      → dropdowns / popovers
 *   --bg-hover         → hover state
 *   --border-strong    → emphasised borders
 * Derive those here so an imported theme recolors the whole app, not just the
 * canvas and body text. Mix direction is mode-aware: in dark mode the panel
 * floor sits darker than the canvas and hovers lift lighter; light mode is the
 * inverse.
 */
function tweakcnSemanticVars(
  group: Record<string, string>,
  modeName: Mode,
): Record<string, string> {
  const pick = (key: string) => group[key] ?? group[`--${key}`];
  const accent = pick("primary") || pick("ring") || pick("accent");
  const bg = pick("background");
  const card = pick("card");
  const popover = pick("popover");
  const border = pick("border");
  // Panel = deepest floor (darker in dark mode, lighter in light mode).
  // Hover = lifted surface (lighter in dark mode, darker in light mode).
  const deepen = modeName === "light" ? "white" : "black";
  const lift = modeName === "light" ? "black" : "white";

  const out: Record<string, string> = {};
  if (accent) {
    out["--accent-presence"] = accent;
    out["--accent-presence-foreground"] =
      pick("primary-foreground") || pick("accent-foreground") || readableTextColor(accent);
    out["--accent-presence-soft"] = `color-mix(in oklch, ${accent} 78%, transparent)`;
    out["--accent-faint"] = `color-mix(in oklch, ${accent} 14%, transparent)`;
  }
  if (bg) {
    out["--bg-panel"] = `color-mix(in oklch, ${bg} 92%, ${deepen})`;
    out["--bg-hover"] = `color-mix(in oklch, ${bg} 84%, ${lift})`;
  }
  const elevated = popover || card;
  if (elevated) out["--bg-elevated"] = elevated;
  if (border) {
    out["--border-strong"] = accent
      ? `color-mix(in oklch, ${border} 62%, ${accent} 38%)`
      : border;
  }
  return out;
}

/**
 * Enrich an imported tweakcn theme with the derived Cave semantic tokens
 * (see tweakcnSemanticVars). The extra tokens are baked into each mode group so
 * BOTH the live apply path (applyCustomVars) and the flash-free boot script
 * (theme-script.tsx) replay identical data with no further logic. Raw tweakcn
 * keys are preserved (and win on the unlikely collision) by spreading last.
 */
function enrichTweakcnTheme(data: CustomThemeData): CustomThemeData {
  const enrich = (group: Record<string, string> | undefined, modeName: Mode) =>
    group ? { ...tweakcnSemanticVars(group, modeName), ...group } : group;
  const { theme, light, dark } = data.cssVars;
  return {
    name: data.name,
    cssVars: {
      ...(theme ? { theme } : {}),
      ...(light ? { light: enrich(light, "light") } : {}),
      ...(dark ? { dark: enrich(dark, "dark") } : {}),
    },
  };
}

function clearCustomTheme() {
  clearCustomThemeVariables();
  document.documentElement.setAttribute("data-theme", "coven");
  updateAppPreferences({ appearance: { theme: { id: "coven", custom: null } } });
  reapplyIndependentAppearance();
}

function readPersistedTheme(): ActiveTheme {
  const raw = readAppPreferences().appearance.theme.id;
  if (raw === "custom" || (THEME_IDS as readonly string[]).includes(raw)) return raw as ActiveTheme;
  return "coven";
}

function readPersistedMode(): ModePref {
  return readAppPreferences().appearance.theme.modePreference;
}

// ─── Preset cards ─────────────────────────────────────────────────────────────────────────────

interface ThemePresetEntry {
  id: ThemeId;
  label: string;
  description: string;
}

const PRESETS: ThemePresetEntry[] = THEME_IDS.map((id) => ({
  id,
  label: THEME_META[id].name,
  description: THEME_META[id].description,
}));

function ThemePresetCard({
  preset,
  mode,
  active,
  onSelect,
}: {
  preset: ThemePresetEntry;
  mode: Mode;
  active: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const swatches = getSwatches(preset.id, mode);
  return (
    <button
      type="button"
      onClick={() => onSelect(preset.id)}
      aria-pressed={active}
      className={`focus-ring relative flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 text-left transition-all ${
        active
          ? "border-[var(--accent-presence)] bg-[var(--bg-raised)] ring-1 ring-[var(--accent-presence)]"
          : "border-[var(--border-hairline)] bg-[var(--bg-base)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-5 w-5 rounded-full border border-[var(--border-hairline)]"
          style={{ background: swatches.bg }}
          title="Background"
        />
        <span
          className="h-5 w-5 rounded-full"
          style={{ background: swatches.accent }}
          title="Accent"
        />
        <span
          className="h-5 w-5 rounded-full border-2"
          style={{ background: swatches.bg, borderColor: swatches.border }}
          title="Border"
        />
      </div>

      <div className="min-w-0">
        <p className="text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">{preset.label}</p>
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)] leading-snug">{preset.description}</p>
      </div>

      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]">
          <Icon name="ph:check-bold" width={11} />
        </span>
      )}
    </button>
  );
}

// Friendly labels for the 8 overridable core tokens.
const TOKEN_LABELS: Record<(typeof THEME_SYNC_KEYS)[number], string> = {
  "--bg-base": "Background",
  "--bg-raised": "Raised surface",
  "--bg-elevated": "Elevated surface",
  "--text-primary": "Primary text",
  "--text-secondary": "Secondary text",
  "--text-muted": "Muted text",
  "--border-hairline": "Border",
  "--accent-presence": "Accent",
};

// Snapshot keys captured when a token edit forks a preset into a custom theme.
// Flipping data-theme to "custom" un-applies the preset's whole CSS block, so
// beyond the 8 editable tokens the fork must pin every per-theme hardcoded
// colour (panel / hover / accent derivatives) plus the legacy shadcn-vocab
// aliases some surfaces still read (bg-background / bg-card / border-border /
// text-foreground) — otherwise editing one token silently resets the rest of
// the look to the default theme instead of layering on the selected one.
const THEME_FORK_SNAPSHOT_KEYS = [
  ...THEME_SYNC_KEYS,
  "--bg-panel",
  "--bg-hover",
  "--border-strong",
  "--accent-presence-foreground",
  "--accent-presence-soft",
  "--accent-faint",
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--border",
  "--foreground",
  "--muted-foreground",
] as const;

/** Companion tokens that must follow an edited core token so the theme stays
 *  coherent: the legacy shadcn-vocab aliases each core token maps onto, the
 *  bg-base surface ramp, and the accent-derived tints (readable foreground,
 *  faint/soft washes — same derivations as the tweakcn import path). */
function deriveTokenCompanions(key: string, value: string, mode: Mode): Record<string, string> {
  switch (key) {
    case "--bg-base": {
      const deepen = mode === "light" ? "white" : "black";
      const lift = mode === "light" ? "black" : "white";
      return {
        "--background": value,
        "--bg-panel": `color-mix(in oklch, ${value} 92%, ${deepen})`,
        "--bg-hover": `color-mix(in oklch, ${value} 84%, ${lift})`,
      };
    }
    case "--bg-raised":
      return { "--card": value, "--popover": value };
    case "--bg-elevated":
      return { "--muted": value };
    case "--text-primary":
      return { "--foreground": value };
    case "--text-secondary":
      return { "--muted-foreground": value };
    case "--border-hairline":
      return { "--border": value };
    case "--accent-presence":
      return {
        "--accent-presence-foreground": readableTextColor(value),
        "--accent-presence-soft": `color-mix(in oklch, ${value} 78%, transparent)`,
        "--accent-faint": `color-mix(in oklch, ${value} 14%, transparent)`,
      };
    default:
      return {};
  }
}

/** Keep the original value's alpha byte when replacing a translucent token
 *  (hairline borders are 12–40% washes; an opaque replacement reads heavy). */
function withAlphaFrom(prev: string | undefined, hex: string): string {
  const m = prev ? /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(prev.trim()) : null;
  return m ? `${hex}${m[1]}` : hex;
}

/** Override a single core token. Forks the active theme to a custom theme so
 *  the edit sticks (and re-syncs). Leaving a preset snapshots the preset's
 *  WHOLE look (THEME_FORK_SNAPSHOT_KEYS) — resolved BEFORE any DOM mutation —
 *  and the whole group is applied live, so only the edited token (plus its
 *  companions) changes on the selected theme. */
function applyTokenOverride(key: string, hex: string, mode: Mode) {
  const html = document.documentElement;
  const preferences = readAppPreferences();
  const themePreferences = preferences.appearance.theme;
  const existing: CustomThemeData | null =
    themePreferences.id === "custom" ? themePreferences.custom : null;
  const groupKey: "light" | "dark" = mode === "light" ? "light" : "dark";
  const otherGroupKey: "light" | "dark" = groupKey === "light" ? "dark" : "light";
  const group: Record<string, string> = { ...(existing?.cssVars?.[groupKey] ?? {}) };
  // Fresh fork from a preset: snapshot BOTH mode palettes while the preset CSS
  // is still applied. Seeding only the edited mode made the fork single-mode —
  // a later Light/Dark flip kept rendering this mode's colors
  // (activeCustomThemeVariables falls back to the only group) and the first
  // edit in the other mode seeded it from the wrong mode's look. Clear in-drag
  // preview inline vars first so both snapshots read the preset (the live
  // re-apply below restores the finished look); flipping data-mode +
  // getComputedStyle forces a synchronous recalc, so nothing paints mid-flip.
  // Imported customs missing one mode group keep the fill-on-first-edit
  // fallback — their preset is long gone, the current look is all there is.
  let otherSeed: Record<string, string> | null = null;
  if (!existing) {
    for (const name of THEME_FORK_SNAPSHOT_KEYS) html.style.removeProperty(name);
    Object.assign(group, resolveTokens(THEME_FORK_SNAPSHOT_KEYS));
    const restore = html.getAttribute("data-mode") ?? groupKey;
    html.setAttribute("data-mode", otherGroupKey);
    otherSeed = resolveTokens(THEME_FORK_SNAPSHOT_KEYS);
    html.setAttribute("data-mode", restore);
  } else if (Object.keys(group).length === 0) {
    Object.assign(group, resolveTokens(THEME_FORK_SNAPSHOT_KEYS));
  }
  group[key] = hex;
  Object.assign(group, deriveTokenCompanions(key, hex, mode));
  const baseTheme = html.getAttribute("data-theme");
  const forkName =
    baseTheme && baseTheme !== "custom" && (THEME_IDS as readonly string[]).includes(baseTheme)
      ? `${THEME_META[baseTheme as ThemeId].name} (custom)`
      : "Custom";
  const data: CustomThemeData = {
    name: existing?.name ?? forkName,
    cssVars: {
      ...(existing?.cssVars ?? {}),
      [groupKey]: group,
      ...(otherSeed ? { [otherGroupKey]: otherSeed } : {}),
    },
  };
  // An explicit accent pick is a statement of intent: disarm the backdrop's
  // auto-match in the same atomic patch, or applyBackdropToDocument re-fits
  // --accent-presence to the image seed on the very next reconcile and the
  // pick never renders (the backdrop settings toggle re-arms matching).
  const backdrop = preferences.appearance.backdrop;
  const disarmBackdropAccent =
    key === "--accent-presence" && backdrop.enabled && backdrop.matchAccent;
  updateAppPreferences({
    appearance: {
      theme: { id: "custom", resolvedMode: mode, custom: data },
      ...(disarmBackdropAccent ? { backdrop: { matchAccent: false } } : {}),
    },
  });
  // Live-apply the whole group — not just the edited key — so the selected
  // theme's look survives the data-theme flip. Boot (theme-init.js) replays
  // this exact group, so what you see now is what a reload restores.
  // Normalize to custom-property names: imported tweakcn groups keep raw keys
  // ("background", "radius"), and a raw setProperty would set the real CSS
  // property inline on <html>, which no cleanup path removes (cave-7eno).
  for (const [name, value] of Object.entries(group)) {
    html.style.setProperty(name.startsWith("--") ? name : `--${name}`, value);
  }
  html.setAttribute("data-theme", "custom");
}

/** Paint-only in-drag preview: writes the edited token + its companions inline
 *  so the pick renders instantly, without touching the preferences store — no
 *  reconcile, no PATCH, no cross-tab broadcast per pointer-move. Inline
 *  element.style beats whichever preset/custom CSS block is active, so no
 *  data-theme flip is needed; commit (applyTokenOverride) makes it durable. */
function previewTokenOverride(key: string, hex: string, mode: Mode) {
  const html = document.documentElement;
  html.style.setProperty(key, hex);
  for (const [name, value] of Object.entries(deriveTokenCompanions(key, hex, mode))) {
    html.style.setProperty(name, value);
  }
}

/** One editable token row — swatch button opening the in-app ColorPicker
 *  (spectrum + hex field + theme/recent swatches) in a popover. */
function TokenColorRow({
  token,
  label,
  value,
  themeSwatches,
  recents,
  onChange,
  onCommit,
}: {
  token: string;
  label: string;
  value: string;
  themeSwatches: ColorSwatch[];
  recents: string[];
  onChange: (hex: string) => void;
  onCommit: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const hex = value.slice(0, 7) || "#000000";
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Pick ${label} color`}
        title={`Pick ${label} color`}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring h-6 w-6 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-strong)] transition-transform hover:scale-110"
        style={{ background: value }}
      />
      <span className="flex-1 text-[length:var(--text-sm)] text-[var(--text-primary)]">{label}</span>
      <code className="font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">{token}</code>
      <span className="w-[72px] shrink-0 text-right font-mono text-[length:var(--text-xs)] uppercase text-[var(--text-secondary)]" title={value}>
        {hex}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onCommit();
        }}
        anchorRef={anchorRef}
        placement="bottom-start"
        offset={8}
        ariaLabel={`${label} color picker`}
      >
        <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl">
          <ColorPicker value={hex} onChange={onChange} themeSwatches={themeSwatches} recents={recents} />
        </div>
      </Popover>
    </div>
  );
}

/** Per-token override list — every core theme token with a colour swatch you can
 *  edit. Editing applies live on the selected theme, forks it to a custom theme,
 *  and re-syncs. */
function ThemeTokenOverrides({
  mode,
  reloadKey,
  onChange,
}: {
  mode: Mode;
  reloadKey: string;
  onChange: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setValues(resolveSyncTokens());
  }, [reloadKey]);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const themeSwatches: ColorSwatch[] = useMemo(
    () =>
      THEME_IDS.map((id) => ({
        hex: mode === "light" ? THEME_META[id].accentLight : THEME_META[id].accentDark,
        label: THEME_META[id].name,
      })),
    [mode],
  );
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(getRecentColors());
  }, []);

  // The picker fires onChange per pointer-move. Drags stay paint-only — each
  // rAF-coalesced frame calls previewTokenOverride (inline vars, store
  // untouched), so nothing reconciles, PATCHes, or broadcasts mid-drag. The
  // durable write (applyTokenOverride → store → PUT) happens once per finished
  // edit, at commit (popover close) or unmount.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ key: string; value: string } | null>(null);
  const dirtyRef = useRef<Set<(typeof THEME_SYNC_KEYS)[number]>>(new Set());
  const flushPendingPreview = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) previewTokenOverride(pending.key, pending.value, modeRef.current);
  }, []);
  // Persist any un-committed edit on unmount so a drag-in-progress isn't lost
  // when the user navigates away with the picker still open.
  useEffect(() => {
    return () => {
      flushPendingPreview();
      for (const key of dirtyRef.current) {
        const value = valuesRef.current[key];
        if (value) applyTokenOverride(key, value, modeRef.current);
      }
      dirtyRef.current.clear();
    };
  }, [flushPendingPreview]);

  const handlePick = (key: (typeof THEME_SYNC_KEYS)[number], hex: string) => {
    // Preserve the token's original alpha byte (hairline borders are washes).
    const next = withAlphaFrom(valuesRef.current[key], hex);
    setValues((v) => ({ ...v, [key]: next }));
    dirtyRef.current.add(key);
    pendingRef.current = { key, value: next };
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) previewTokenOverride(pending.key, pending.value, modeRef.current);
      });
    }
  };

  const handleCommit = (key: (typeof THEME_SYNC_KEYS)[number]) => {
    flushPendingPreview();
    if (!dirtyRef.current.has(key)) return; // opened + closed without a pick
    dirtyRef.current.delete(key);
    const committed = valuesRef.current[key];
    if (!committed) return;
    applyTokenOverride(key, committed, modeRef.current);
    setRecents(addRecentColor(committed.slice(0, 7)));
    onChange();
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
        Override any of the theme&apos;s core tokens. Edits apply live to the
        selected theme, fork it into a custom theme, and sync immediately.
      </p>
      <div className="flex flex-col divide-y divide-[var(--border-hairline)] overflow-hidden rounded-lg border border-[var(--border-hairline)]">
        {THEME_SYNC_KEYS.map((key) => (
          <TokenColorRow
            key={key}
            token={key}
            label={TOKEN_LABELS[key]}
            value={values[key] ?? "#000000"}
            themeSwatches={themeSwatches}
            recents={recents}
            onChange={(hex) => handlePick(key, hex)}
            onCommit={() => handleCommit(key)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Section: Appearance ───────────────────────────────────────────────────────────────────────

// Appearance stacks many groups — tab them so the common controls don't require
// a long scroll. Labels in APPEARANCE_TAB_GROUPS must match each SettingsGroup
// label so search/deep-link can switch to the right tab. Module-level (stable
// ref) so the tab effect doesn't re-run every render.
type AppearanceTab = "theme" | "colors" | "typography" | "interface";
const APPEARANCE_TABS: ReadonlyArray<TabItem<AppearanceTab>> = [
  { id: "theme", label: "Theme" },
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "interface", label: "Interface" },
];
const APPEARANCE_TAB_GROUPS: Record<AppearanceTab, readonly string[]> = {
  theme: ["Mode", "Theme", "Import from tweakcn"],
  colors: ["Theme tokens"],
  typography: ["Typography", "Reading text", "Date & time"],
  interface: ["Corners"],
};

export function AppearanceSection({ scrollTarget, searchJump }: { scrollTarget?: string | null; searchJump?: number }) {
  const [activeTheme, setActiveTheme] = useState<ActiveTheme>("coven");
  const [mode, setMode] = useState<ModePref>("dark");
  const [customData, setCustomData] = useState<CustomThemeData | null>(null);
  const [appearanceHydrated, setAppearanceHydrated] = useState(false);

  // No on-change daemon mirror here: RemoteThemeController publishes tokens
  // whenever the canonical theme signature changes (every selection, mode flip,
  // and token commit in this section writes updateAppPreferences). A section-
  // side effect doubled each PUT /api/theme (cave-gvtw); persistThemeTokens
  // remains for the manual Resync button only.
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; at: string } | null>(null);

  const handleResync = async () => {
    setSyncing(true);
    const ok = await persistThemeTokens();
    announce(ok ? "Theme synced to phone." : "Couldn't reach the daemon to sync.", ok ? "polite" : "assertive");
    setSyncing(false);
    setSyncResult({ ok, at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) });
  };

  const reloadCustomData = () => {
    setActiveTheme("custom");
    setCustomData(readAppPreferences().appearance.theme.custom);
  };
  const [cornerRadius, setCornerRadius] = useState<CornerRadius>("default");

  // Read persisted theme + mode on mount
  useEffect(() => {
    const preferences = readAppPreferences();
    setActiveTheme(readPersistedTheme());
    setMode(readPersistedMode());
    setCornerRadius(readCornerRadius());
    const saved = preferences.appearance.theme.id;
    if (saved === "custom") {
      const raw = preferences.appearance.theme.custom;
      if (raw) {
        try {
          setCustomData(raw);
        } catch {
          /* malformed — ignore */
        }
      }
    }
    setAppearanceHydrated(true);
  }, []);

  // External theme changes — the 10s /api/theme poll, another tab via the
  // preferences BroadcastChannel, a phone PATCH — land in the store and
  // repaint the app, but this section hydrated its selection state once on
  // mount, leaving the theme grid and token-row swatches stale until a full
  // reload (cave-hkfq). Follow the store. setCustomData keeps the previous
  // object when content is unchanged so unrelated store notifies don't churn
  // renders or the token rows' content-keyed reloadKey.
  useEffect(() => {
    if (!appearanceHydrated) return;
    return subscribeAppPreferences(() => {
      const theme = readAppPreferences().appearance.theme;
      setActiveTheme(readPersistedTheme());
      setMode(readPersistedMode());
      const next = theme.id === "custom" ? theme.custom : null;
      setCustomData((prev) => {
        if (prev === next) return prev;
        if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
    });
  }, [appearanceHydrated]);

  const handleSelectPreset = (id: PresetTheme) => {
    setActiveTheme(id);
    setCustomData(null);
    applyPreset(id);
    void showSettingsSavedAfterPreferencesFlush();
  };

  const handleSetCornerRadius = (next: CornerRadius) => {
    setCornerRadius(next);
    applyCornerRadius(next);
    void showSettingsSavedAfterPreferencesFlush();
  };

  const handleSetMode = (next: ModePref) => {
    setMode(next);
    applyMode(next);
    // If a custom theme is active, re-apply with the new mode group.
    if (activeTheme === "custom" && customData) {
      applyCustomVars(customData.cssVars, resolveMode(next));
    }
    void showSettingsSavedAfterPreferencesFlush();
  };

  // Two-step: an imported/tuned theme is unrecoverable once cleared (recovery
  // = re-import from a remembered URL), and the trigger is a ~14px X. First
  // click arms, second confirms; arming auto-disarms after a beat (cave-5lsj).
  const [resetCustomArmed, setResetCustomArmed] = useState(false);
  useEffect(() => {
    if (!resetCustomArmed) return;
    const t = window.setTimeout(() => setResetCustomArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [resetCustomArmed]);
  const handleResetCustom = () => {
    if (!resetCustomArmed) {
      setResetCustomArmed(true);
      return;
    }
    setResetCustomArmed(false);
    clearCustomTheme();
    setActiveTheme("coven");
    setCustomData(null);
    void showSettingsSavedAfterPreferencesFlush();
  };

  function normalizeTweakcnUrl(raw: string): string | null {
    try {
      const url = new URL(raw.trim());
      const hostname = url.hostname.toLowerCase();
      if (!(hostname === "tweakcn.com" || hostname.endsWith(".tweakcn.com")))
        return null;
      if (url.pathname.startsWith("/r/themes/")) {
        const themeId = url.pathname.replace("/r/themes/", "").split("/")[0];
        if (themeId)
          return `https://tweakcn.com/r/themes/${encodeURIComponent(themeId)}`;
      }
      if (url.pathname.startsWith("/themes/")) {
        const themeId = url.pathname.replace("/themes/", "").split("/")[0];
        if (themeId)
          return `https://tweakcn.com/r/themes/${encodeURIComponent(themeId)}`;
      }
      if (url.pathname.startsWith("/editor/theme")) {
        const themeName = url.searchParams.get("theme")?.trim();
        if (themeName)
          return `https://tweakcn.com/r/themes/${encodeURIComponent(themeName)}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  const handleImport = async () => {
    setImportError(null);
    const canonical = normalizeTweakcnUrl(importUrl);
    if (!canonical) {
      const msg = "Invalid tweakcn URL. Expected https://tweakcn.com/themes/{id}, /r/themes/{id}, or /editor/theme?theme={name}.";
      setImportError(msg);
      announce(msg, "assertive");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch(canonical);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

      // biome-ignore lint/suspicious/noExplicitAny: tweakcn response shape
      const json = (await res.json()) as any;
      const cssVars = json?.cssVars;
      const hasTheme = cssVars?.theme && typeof cssVars.theme === "object";
      const hasDark = cssVars?.dark && typeof cssVars.dark === "object";
      const hasLight = cssVars?.light && typeof cssVars.light === "object";
      if (!cssVars || (!hasTheme && !hasDark && !hasLight)) {
        throw new Error("Response missing cssVars — not a valid tweakcn theme JSON.");
      }

      const raw: CustomThemeData = {
        name: (json.name as string) || canonical.split("/").pop() || "custom",
        cssVars: cssVars as CustomThemeData["cssVars"],
      };
      // Translate shadcn base tokens into the Cave's semantic vocabulary so the
      // import recolors the accent, sidebar, popovers and hover states — not
      // just the canvas (see enrichTweakcnTheme / tweakcnSemanticVars).
      const data = enrichTweakcnTheme(raw);

      applyCustomVars(data.cssVars, resolveMode(mode));
      updateAppPreferences({
        appearance: {
          theme: { id: "custom", resolvedMode: resolveMode(mode), custom: data },
        },
      });
      setCustomData(data);
      setActiveTheme("custom");
      setImportUrl("");
      announce(`Imported theme "${data.name}".`);
      showSettingsSavedToast("Theme imported.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      setImportError(msg);
      announce(`Theme import failed: ${msg}`, "assertive");
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsPage section="appearance" title="Appearance" description="Colors and visual style.">
      <SettingsTabbed
        ariaLabel="Appearance settings"
        tabs={APPEARANCE_TABS}
        groupsByTab={APPEARANCE_TAB_GROUPS}
        scrollTarget={scrollTarget}
        searchJump={searchJump}
      >
        {(tab) => (
          <>
      {/* ── Mode toggle ── */}
      {tab === "theme" && (
      <SettingsGroup label="Mode">
        <div className="px-4 py-3">
          <ModeToggle value={mode} onChange={handleSetMode} />
        </div>
      </SettingsGroup>
      )}

      {/* ── Preset themes ── */}
      {tab === "theme" && (
      <SettingsGroup label="Theme">
        {/* Custom theme chip */}
        {activeTheme === "custom" && customData && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-hairline)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-3 py-0.5 text-[length:var(--text-xs)] font-medium text-[var(--text-primary)]">
              <Icon name="ph:sparkle" width={11} className="text-[var(--accent-presence)]" />
              Custom: {customData.name}
              {resetCustomArmed ? (
                <Button
                  variant="danger-ghost"
                  size="xs"
                  className="ml-1"
                  onClick={handleResetCustom}
                  aria-label={`Really discard ${customData.name}? Click again to confirm`}
                >
                  Discard?
                </Button>
              ) : (
                <IconButton
                  icon="ph:x-bold"
                  size="xs"
                  className="ml-1"
                  onClick={handleResetCustom}
                  aria-label={`Discard ${customData.name}`}
                />
              )}
            </span>
            <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {resetCustomArmed
                ? "Click again to discard — re-importing needs the original URL."
                : "Active — presets below will override."}
            </span>
          </div>
        )}

        {/* Preset grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {PRESETS.map((preset) => (
            <ThemePresetCard
              key={preset.id}
              preset={preset}
              mode={resolveMode(mode)}
              active={activeTheme === preset.id}
              onSelect={handleSelectPreset}
            />
          ))}
        </div>
      </SettingsGroup>
      )}

      {/* ── Per-token overrides + manual resync ── the single place to customize
          the selected theme's colors (the old three-color editor was redundant
          with this panel and has been removed). */}
      {tab === "colors" && (
      <SettingsGroup label="Theme tokens">
        <ThemeTokenOverrides
          mode={resolveMode(mode)}
          reloadKey={`${activeTheme}:${mode}:${customData ? JSON.stringify(customData.cssVars) : "preset"}`}
          onChange={() => {
            reloadCustomData();
            void showSettingsSavedAfterPreferencesFlush();
          }}
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-hairline)] px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleResync()}
            loading={syncing}
            disabled={syncing}
            leadingIcon="ph:arrows-clockwise"
          >
            {syncing ? "Syncing…" : "Resync to phone"}
          </Button>
          <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {syncResult
              ? syncResult.ok
                ? `Synced at ${syncResult.at}.`
                : "Couldn’t reach the daemon — is it running?"
              : "Your theme syncs to the phone automatically; resync to push it now."}
          </span>
        </div>
      </SettingsGroup>
      )}

      {/* ── tweakcn import ── */}
      {tab === "theme" && (
      <SettingsGroup label="Import from tweakcn">
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            Use Browse to open tweakcn.com in the in-app browser, then paste a theme URL to apply it. Supports{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[length:var(--text-xs)]">
              /themes/&#123;id&#125;
            </code>
            ,{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[length:var(--text-xs)]">
              /r/themes/&#123;id&#125;
            </code>
            , and{" "}
            <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[length:var(--text-xs)]">
              /editor/theme?theme=&#123;name&#125;
            </code>
            .
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={() => openExternalUrl("https://tweakcn.com/editor/theme")}
              leadingIcon="ph:globe"
              title="Browse tweakcn themes in the in-app browser"
            >
              Browse
            </Button>
            <input
              type="url"
              value={importUrl}
              onChange={(e) => {
                setImportUrl(e.target.value);
                setImportError(null);
              }}
              placeholder="https://tweakcn.com/r/themes/amethyst-haze"
              className="focus-ring flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[length:var(--text-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleImport();
              }}
            />
            <Button
              variant="primary"
              className="shrink-0"
              onClick={() => void handleImport()}
              loading={importing}
              disabled={importing || !importUrl.trim()}
              leadingIcon="ph:arrow-down-bold"
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
          {importError && (
            <p role="alert" className="flex items-start gap-1.5 text-[length:var(--text-xs)] text-[var(--color-danger)]">
              <Icon name="ph:warning-circle" width={12} className="mt-px shrink-0" />
              {importError}
            </p>
          )}
        </div>
      </SettingsGroup>
      )}

      {tab === "typography" && <FontSettings />}

      {/* ── Backdrop ── an image behind Home + Chat with the accent tinted to
          match it (cave-backdrop.ts owns storage + the vibe derivation). */}
      <SettingsGroup label="Backdrop">
        <BackdropSettings />
      </SettingsGroup>

      {/* ── Corner radius ── a minor shape tweak (drives the shared --radius
          tokens), kept last so the primary color/theme and text controls lead. */}
      {tab === "interface" && (
      <SettingsGroup label="Corners">
        <SettingControlRow
          label="Corner radius"
          hint="Roundedness of buttons, cards, and the familiar switcher."
        >
          <Segmented
            ariaLabel="Corner radius"
            options={CORNER_RADIUS_OPTIONS}
            value={cornerRadius}
            onChange={(option) => handleSetCornerRadius(option)}
            getLabel={(option) => CORNER_RADIUS_LABELS[option]}
          />
        </SettingControlRow>
      </SettingsGroup>
      )}
          </>
        )}
      </SettingsTabbed>
    </SettingsPage>
  );
}

