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
import { getSwatches, THEME_META, type ThemeId } from "@/lib/theme-palettes";
import {
  COVEN_CUSTOM_THEME_KEY,
  COVEN_THEME_KEY,
  type Mode,
} from "@/lib/theme-storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThreeColors {
  bg: string;
  accent: string;
  border: string;
}

interface ColorSlotProps {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
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

function ColorSlot({ label, description, value, onChange }: ColorSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState(value);

  // Keep text input in sync when value changes externally (e.g. preset switch).
  useEffect(() => {
    setInputVal(value);
  }, [value]);

  // Native <input type="color"> only accepts 6-char #rrggbb. Strip alpha.
  const pickerValue = value.replace(/^#([0-9a-fA-F]{6}).*$/, "#$1");

  const commitTextInput = (raw: string) => {
    const trimmed = raw.trim();
    // Accept: #rgb, #rrggbb, #rrggbbaa; or named/keyword colors
    if (/^#([0-9a-fA-F]{3,8})$/.test(trimmed) || /^[a-z]+$/i.test(trimmed)) {
      onChange(trimmed);
    }
    // Re-sync display even if invalid
    setInputVal(trimmed || value);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-3">
      {/* Color swatch / native picker trigger */}
      <button
        type="button"
        aria-label={`Pick ${label} color`}
        onClick={() => inputRef.current?.click()}
        className="focus-ring relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border-2 border-[var(--border-strong)] shadow-sm transition-transform hover:scale-105 active:scale-95"
        style={{ background: value }}
      >
        <Icon
          name="ph:paint-brush"
          width={14}
          className="absolute inset-0 m-auto text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>

      {/* Hidden native color input */}
      <input
        ref={inputRef}
        type="color"
        className="sr-only"
        value={pickerValue}
        onChange={(e) => {
          setInputVal(e.target.value);
          onChange(e.target.value);
        }}
      />

      {/* Labels */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{description}</p>
      </div>

      {/* Hex text input */}
      <input
        type="text"
        value={inputVal}
        maxLength={9}
        spellCheck={false}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={(e) => commitTextInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitTextInput((e.target as HTMLInputElement).value);
        }}
        className="w-[88px] shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-presence)] focus:ring-1 focus:ring-[var(--accent-presence)]"
        aria-label={`${label} hex value`}
      />
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
        />
        <ColorSlot
          label="Accent"
          description="Highlights, active states, buttons"
          value={colors.accent}
          onChange={(v) => updateColor("accent", v)}
        />
        <ColorSlot
          label="Border"
          description="Hairline borders and dividers"
          value={colors.border}
          onChange={(v) => updateColor("border", v)}
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
