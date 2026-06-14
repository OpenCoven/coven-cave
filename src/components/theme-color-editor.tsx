"use client";

/**
 * ThemeColorEditor
 *
 * Inline color-refinement panel that appears beneath the preset grid when the
 * user selects a preset **or** has an existing custom theme active. Exposes
 * three color pickers — Background, Accent, Border — seeded from the selected
 * preset's swatches. Edits are applied live to CSS custom properties on
 * <html> and persisted in localStorage as `coven-custom-theme`.
 *
 * The saved object format is compatible with the existing CustomThemeData
 * contract already read by AppearanceSection.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { getSwatches, THEME_IDS, THEME_META, type ThemeId } from "@/lib/theme-palettes";
import {
  COVEN_CUSTOM_THEME_KEY,
  COVEN_THEME_KEY,
  type Mode,
} from "@/lib/theme-storage";
import { ColorPicker, type ColorSwatch } from "@/components/ui/color-picker";
import { Popover } from "@/components/ui/popover";
import { addRecentColor, getRecentColors } from "@/lib/recent-colors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThreeColors {
  bg: string;
  accent: string;
  border: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive border alpha hex from accent. Default: 40% opacity (66 hex). */
function deriveBorderFromAccent(accent: string): string {
  // Strip leading #
  const hex = accent.replace(/^#/, "");
  if (hex.length === 6) return `#${hex}66`;
  return accent;
}

/**
 * Resolve any CSS color string to a 6-char #rrggbb the hex picker can display.
 * Hex (incl. #rrggbbaa, alpha dropped) is handled directly; oklch()/named/rgb()
 * are resolved through the browser's computed style. Returns #000000 if unresolvable.
 */
function resolveToHex(color: string): string {
  const direct = /^#([0-9a-fA-F]{6})/.exec(color.trim());
  if (direct) return `#${direct[1].toLowerCase()}`;
  if (typeof document === "undefined") return "#000000";
  const el = document.createElement("span");
  el.style.color = color;
  el.style.display = "none";
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = /rgba?\(([^)]+)\)/.exec(rgb);
  if (!m) return "#000000";
  const parts = m[1].split(/[\s,]+/).filter(Boolean);
  const [r, g, b] = parts.map((n) => parseInt(n, 10));
  const hex = [r, g, b].map((n) => (Number.isFinite(n) ? n : 0).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

/**
 * Write three colors to CSS vars on <html>. We map them to the Cave
 * custom-theme var set: --bg-base (background), --accent-presence (accent),
 * and --border-hairline (border). We also write --bg-card / --bg-raised as
 * lightened/darkened bg variants so the rest of the UI stays coherent.
 */
function applyColorsToDOM(colors: ThreeColors, _mode: Mode) {
  const html = document.documentElement;
  html.setAttribute("data-theme", "custom");

  const set = (prop: string, val: string) =>
    html.style.setProperty(prop, val);

  set("--accent-presence", colors.accent);
  set("--accent-faint", `${colors.accent}22`);
  set("--bg-base", colors.bg);
  // bg-raised / bg-card are slightly lighter than bg-base; for now we use
  // color-mix which is broadly supported in our target Chromium/WebKit.
  set("--bg-raised", `color-mix(in oklch, ${colors.bg} 90%, white 10%)`);
  set("--bg-card", `color-mix(in oklch, ${colors.bg} 93%, white 7%)`);
  set("--bg-elevated", `color-mix(in oklch, ${colors.bg} 85%, white 15%)`);
  set("--border-hairline", colors.border);
  set("--border-strong", `color-mix(in oklch, ${colors.border} 60%, ${colors.accent} 40%)`);
}

function persistCustomTheme(presetBase: ThemeId, colors: ThreeColors, mode: Mode) {
  const modeGroup = {
    "--bg-base": colors.bg,
    "--bg-raised": `color-mix(in oklch, ${colors.bg} 90%, white 10%)`,
    "--bg-card": `color-mix(in oklch, ${colors.bg} 93%, white 7%)`,
    "--bg-elevated": `color-mix(in oklch, ${colors.bg} 85%, white 15%)`,
    "--accent-presence": colors.accent,
    "--accent-faint": `${colors.accent}22`,
    "--border-hairline": colors.border,
    "--border-strong": `color-mix(in oklch, ${colors.border} 60%, ${colors.accent} 40%)`,
  };
  const data = {
    name: `${THEME_META[presetBase].name} (custom)`,
    cssVars: {
      ...(mode === "light" ? { light: modeGroup } : { dark: modeGroup }),
    },
  };
  localStorage.setItem(COVEN_CUSTOM_THEME_KEY, JSON.stringify(data));
  localStorage.setItem(COVEN_THEME_KEY, "custom");
}

// ─── ColorSlot ────────────────────────────────────────────────────────────────

interface ColorSlotProps {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  themeSwatches: ColorSwatch[];
  recents: string[];
  onCommit: () => void;
}

function ColorSlot({ label, description, value, onChange, themeSwatches, recents, onCommit }: ColorSlotProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Only resolve through the DOM when the picker is open (oklch bg etc.); hex is fast-pathed.
  const pickerHex = open ? resolveToHex(value) : value;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-3">
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Pick ${label} color`}
        title={`Pick ${label} color`}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring group/swatch relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border-2 border-[var(--border-strong)] shadow-sm transition-transform hover:scale-105 active:scale-95"
        style={{ background: value }}
      >
        <Icon
          name="ph:eyedropper"
          width={14}
          className="pointer-events-none text-white opacity-0 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] transition-opacity group-hover/swatch:opacity-100"
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{description}</p>
      </div>

      <span
        className="w-[92px] shrink-0 truncate rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-right font-mono text-[11px] uppercase text-[var(--text-secondary)]"
        title={value}
      >
        {value}
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
      >
        <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl">
          <ColorPicker value={pickerHex} onChange={onChange} themeSwatches={themeSwatches} recents={recents} />
        </div>
      </Popover>
    </div>
  );
}

// ─── ThemeColorEditor ─────────────────────────────────────────────────────────

export interface ThemeColorEditorProps {
  /** The preset that seeds the default colors. */
  basePreset: ThemeId;
  mode: Mode;
  /** Called whenever the user saves / resets. */
  onSave?: (colors: ThreeColors) => void;
  onReset?: () => void;
}

export function ThemeColorEditor({
  basePreset,
  mode,
  onSave,
  onReset,
}: ThemeColorEditorProps) {
  const swatches = getSwatches(basePreset, mode);

  // Seed colors from the preset. Re-seed whenever the preset or mode changes
  // (unless the user already has edits — we only auto-seed when the editor first
  // opens for a given preset, not on every re-render).
  const lastPresetRef = useRef<string>(`${basePreset}:${mode}`);
  const [colors, setColors] = useState<ThreeColors>({
    bg: swatches.bg,
    accent: swatches.accent,
    border: swatches.border,
  });
  const [saved, setSaved] = useState(false);

  // When the base preset or mode changes, re-seed.
  useEffect(() => {
    const key = `${basePreset}:${mode}`;
    if (key !== lastPresetRef.current) {
      lastPresetRef.current = key;
      const s = getSwatches(basePreset, mode);
      setColors({ bg: s.bg, accent: s.accent, border: s.border });
      setSaved(false);
    }
  }, [basePreset, mode]);

  // Live-apply changes as user picks.
  useEffect(() => {
    applyColorsToDOM(colors, mode);
  }, [colors, mode]);

  const updateColor = (key: keyof ThreeColors, value: string) => {
    setColors((prev) => {
      const next = { ...prev, [key]: value };
      // When accent changes, auto-update border if border looks like the old
      // derived value (user hasn't manually tweaked it).
      if (key === "accent") {
        const derivedFromPrev = deriveBorderFromAccent(prev.accent);
        if (prev.border === derivedFromPrev || prev.border === swatches.border) {
          next.border = deriveBorderFromAccent(value);
        }
      }
      return next;
    });
    setSaved(false);
  };

  const themeSwatches: ColorSwatch[] = THEME_IDS.map((id) => ({
    hex: mode === "light" ? THEME_META[id].accentLight : THEME_META[id].accentDark,
    label: THEME_META[id].name,
  }));
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(getRecentColors());
  }, []);
  const commitRecent = (hex: string) => setRecents(addRecentColor(hex));

  const handleSave = () => {
    persistCustomTheme(basePreset, colors, mode);
    setSaved(true);
    onSave?.(colors);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    const s = getSwatches(basePreset, mode);
    const reset = { bg: s.bg, accent: s.accent, border: s.border };
    setColors(reset);
    applyColorsToDOM(reset, mode);
    setSaved(false);
    onReset?.();
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--accent-presence)] bg-[var(--bg-card)] p-4 ring-1 ring-[var(--accent-presence)]/30">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon name="ph:paint-brush" width={14} className="text-[var(--accent-presence)]" />
        <p className="text-[12px] font-semibold text-[var(--text-primary)]">
          Customise colors
        </p>
        <span className="ml-auto rounded-full bg-[var(--accent-faint)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-presence)]">
          {THEME_META[basePreset].name} base
        </span>
      </div>

      {/* Color slots */}
      <div className="space-y-2">
        <ColorSlot
          label="Background"
          description="Base canvas color"
          value={colors.bg}
          onChange={(v) => updateColor("bg", v)}
          themeSwatches={themeSwatches}
          recents={recents}
          onCommit={() => commitRecent(colors.bg)}
        />
        <ColorSlot
          label="Accent"
          description="Highlights, active states, buttons"
          value={colors.accent}
          onChange={(v) => updateColor("accent", v)}
          themeSwatches={themeSwatches}
          recents={recents}
          onCommit={() => commitRecent(colors.accent)}
        />
        <ColorSlot
          label="Border"
          description="Hairline borders and dividers"
          value={colors.border}
          onChange={(v) => updateColor("border", deriveBorderFromAccent(v))}
          themeSwatches={themeSwatches}
          recents={recents}
          onCommit={() => commitRecent(colors.border)}
        />
      </div>

      {/* Preview badge row */}
      <div className="flex items-center gap-2 pt-1">
        <span
          className="flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium"
          style={{
            background: colors.bg,
            color: colors.accent,
            borderColor: colors.border,
          }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: colors.accent }}
          />
          Preview
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">Live preview active</span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-hairline)] pt-3">
        <button
          type="button"
          onClick={handleReset}
          className="focus-ring flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrow-counter-clockwise" width={12} />
          Reset to {THEME_META[basePreset].name}
        </button>
        <button
          type="button"
          onClick={handleSave}
          className={`focus-ring flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
            saved
              ? "bg-[var(--color-success)] text-white"
              : "bg-[var(--accent-presence)] text-white hover:opacity-90"
          }`}
        >
          <Icon name={saved ? "ph:check-bold" : "ph:check-circle"} width={12} />
          {saved ? "Saved!" : "Save theme"}
        </button>
      </div>
    </div>
  );
}
