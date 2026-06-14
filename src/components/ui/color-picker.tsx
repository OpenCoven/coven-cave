"use client";

import { HexColorPicker, HexColorInput } from "react-colorful";
import "@/styles/color-picker.css";

export type ColorSwatch = { hex: string; label: string };

function toPickerHex(value: string): string {
  const m = /^#?([0-9a-fA-F]{6})/.exec(value.trim());
  return m ? `#${m[1]}` : "#000000";
}

function sameHex(a: string, b: string): boolean {
  return toPickerHex(a).toLowerCase() === toPickerHex(b).toLowerCase();
}

function SwatchButton({
  hex,
  label,
  selected,
  onPick,
}: {
  hex: string;
  label: string;
  selected: boolean;
  onPick: (hex: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(hex)}
      aria-label={`Use ${label}`}
      title={label}
      className={`focus-ring h-6 w-6 rounded-md transition-transform hover:scale-110 ${
        selected
          ? "ring-2 ring-[var(--accent-presence)]"
          : "ring-1 ring-[var(--border-strong)]"
      }`}
      style={{ background: hex }}
    />
  );
}

/**
 * In-app color picker (react-colorful spectrum + hex field + swatch rows).
 *
 * `value` MUST be a `#rrggbb` hex string — non-hex inputs (oklch()/rgb()/named,
 * or `#rrggbbaa`) are clamped to `#000000`/stripped. Callers must resolve any
 * non-hex color to hex before passing it in (the theme editor does this via its
 * `resolveToHex` helper). `onChange` emits a 6-char `#rrggbb`.
 */
export function ColorPicker({
  value,
  onChange,
  themeSwatches = [],
  recents = [],
}: {
  value: string;
  onChange: (hex: string) => void;
  themeSwatches?: ColorSwatch[];
  recents?: string[];
}) {
  const pickerValue = toPickerHex(value);
  return (
    <div className="cave-color-picker flex w-[220px] flex-col gap-2.5 p-2">
      <HexColorPicker color={pickerValue} onChange={onChange} />
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-[var(--text-muted)]">#</span>
        <HexColorInput
          color={pickerValue}
          onChange={onChange}
          aria-label="Hex color value"
          className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[11px] uppercase text-[var(--text-secondary)] outline-none"
        />
      </div>
      {themeSwatches.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Themes</p>
          <div className="flex flex-wrap gap-1.5">
            {themeSwatches.map((s) => (
              <SwatchButton key={`t-${s.hex}`} hex={s.hex} label={s.label} selected={sameHex(s.hex, value)} onPick={onChange} />
            ))}
          </div>
        </div>
      ) : null}
      {recents.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Recent</p>
          <div className="flex flex-wrap gap-1.5">
            {recents.map((hex) => (
              <SwatchButton key={`r-${hex}`} hex={hex} label={hex} selected={sameHex(hex, value)} onPick={onChange} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
