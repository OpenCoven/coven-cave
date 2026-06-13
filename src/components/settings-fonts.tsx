"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_FONT_ID,
  FONT_OPTIONS,
  fontOptionById,
  fontStack,
  type FontSlot,
  type FontOption,
} from "@/lib/font-catalog";
import { applyFont, readFontPref, writeFontPref } from "@/lib/font-storage";
import {
  DEFAULT_SCREEN_SCALE,
  SCREEN_SCALE_EVENT,
  SCREEN_SCALE_OPTIONS,
  applyScreenScale,
  readScreenScale,
  type ScreenScale,
} from "@/lib/screen-magnification";
import {
  DEFAULT_READING_LEADING,
  READING_LEADING_OPTIONS,
  applyReadingLeading,
  readReadingLeading,
  type ReadingLeading,
} from "@/lib/reading-leading";
import {
  DEFAULT_READING_TRACKING,
  READING_TRACKING_OPTIONS,
  applyReadingTracking,
  readReadingTracking,
  type ReadingTracking,
} from "@/lib/reading-tracking";
import {
  DEFAULT_READING_ALIGN,
  READING_ALIGN_OPTIONS,
  applyReadingAlign,
  readReadingAlign,
  type ReadingAlign,
} from "@/lib/reading-align";
import {
  DEFAULT_READING_WIDTH,
  READING_WIDTH_OPTIONS,
  applyReadingWidth,
  readReadingWidth,
  type ReadingWidth,
} from "@/lib/reading-width";
import {
  DEFAULT_READING_WEIGHT,
  READING_WEIGHT_OPTIONS,
  applyReadingWeight,
  readReadingWeight,
  type ReadingWeight,
} from "@/lib/reading-weight";

const WIDTH_LABEL: Record<ReadingWidth, string> = {
  full: "Full",
  medium: "Medium",
  narrow: "Narrow",
};

const WEIGHT_LABEL: Record<ReadingWeight, string> = {
  light: "Light",
  normal: "Normal",
  medium: "Medium",
};

const LEADING_LABEL: Record<ReadingLeading, string> = {
  compact: "Compact",
  normal: "Normal",
  relaxed: "Relaxed",
};

const TRACKING_LABEL: Record<ReadingTracking, string> = {
  normal: "Normal",
  wide: "Wide",
  wider: "Wider",
};

const ALIGN_LABEL: Record<ReadingAlign, string> = {
  left: "Left",
  justify: "Justify",
};

const SANS_OPTIONS = FONT_OPTIONS.filter((o) => o.slot === "sans");
const MONO_OPTIONS = FONT_OPTIONS.filter((o) => o.slot === "mono");

const PREVIEW: Record<FontSlot, string> = {
  sans: "The quick brown fox jumps over 0123",
  mono: "const x = 42; // 0123",
};

function FontField({
  slot,
  label,
  options,
  value,
  onChange,
}: {
  slot: FontSlot;
  label: string;
  options: FontOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const opt = fontOptionById(value) ?? fontOptionById(DEFAULT_FONT_ID[slot]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</label>
      <select
        className="gh-select"
        style={{ maxWidth: "260px" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} font`}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <p
        className="text-[15px] text-[var(--text-primary)] truncate"
        style={{ fontFamily: opt ? fontStack(opt) : undefined }}
      >
        {PREVIEW[slot]}
      </p>
    </div>
  );
}

export function FontSettings() {
  const [sansId, setSansId] = useState<string>(DEFAULT_FONT_ID.sans);
  const [monoId, setMonoId] = useState<string>(DEFAULT_FONT_ID.mono);
  const [scale, setScale] = useState<ScreenScale>(DEFAULT_SCREEN_SCALE);
  const [leading, setLeading] = useState<ReadingLeading>(DEFAULT_READING_LEADING);
  const [tracking, setTracking] = useState<ReadingTracking>(DEFAULT_READING_TRACKING);
  const [align, setAlign] = useState<ReadingAlign>(DEFAULT_READING_ALIGN);
  const [width, setWidth] = useState<ReadingWidth>(DEFAULT_READING_WIDTH);
  const [weight, setWeight] = useState<ReadingWeight>(DEFAULT_READING_WEIGHT);

  useEffect(() => {
    const sans = readFontPref("sans");
    const mono = readFontPref("mono");
    setSansId(sans);
    setMonoId(mono);
    applyFont("sans", sans);
    applyFont("mono", mono);
    // The mounted Screen/Reading controllers already applied these on load;
    // we only mirror them into local UI state.
    setScale(readScreenScale());
    setLeading(readReadingLeading());
    setTracking(readReadingTracking());
    setAlign(readReadingAlign());
    setWidth(readReadingWidth());
    setWeight(readReadingWeight());
  }, []);

  // Keep the segmented control in sync with the ⌘+/⌘−/⌘0 keyboard shortcuts,
  // which dispatch SCREEN_SCALE_EVENT from the controller.
  useEffect(() => {
    const onScaleChange = (event: Event) => {
      const next = (event as CustomEvent<{ scale?: ScreenScale }>).detail?.scale;
      if (next) setScale(next);
    };
    window.addEventListener(SCREEN_SCALE_EVENT, onScaleChange);
    return () => window.removeEventListener(SCREEN_SCALE_EVENT, onScaleChange);
  }, []);

  const select = (slot: FontSlot, id: string) => {
    if (slot === "sans") setSansId(id);
    else setMonoId(id);
    writeFontPref(slot, id);
    applyFont(slot, id);
  };

  const setTextSize = (next: ScreenScale) => {
    setScale(next);
    applyScreenScale(next);
  };

  const setLineSpacing = (next: ReadingLeading) => {
    setLeading(next);
    applyReadingLeading(next);
  };

  const setLetterSpacing = (next: ReadingTracking) => {
    setTracking(next);
    applyReadingTracking(next);
  };

  const setTextAlign = (next: ReadingAlign) => {
    setAlign(next);
    applyReadingAlign(next);
  };

  const setReadingWidth = (next: ReadingWidth) => {
    setWidth(next);
    applyReadingWidth(next);
  };

  const setFontWeight = (next: ReadingWeight) => {
    setWeight(next);
    applyReadingWeight(next);
  };

  const reset = () => {
    select("sans", DEFAULT_FONT_ID.sans);
    select("mono", DEFAULT_FONT_ID.mono);
    setTextSize(DEFAULT_SCREEN_SCALE);
    setLineSpacing(DEFAULT_READING_LEADING);
    setLetterSpacing(DEFAULT_READING_TRACKING);
    setTextAlign(DEFAULT_READING_ALIGN);
    setReadingWidth(DEFAULT_READING_WIDTH);
    setFontWeight(DEFAULT_READING_WEIGHT);
  };

  const isDefault =
    sansId === DEFAULT_FONT_ID.sans &&
    monoId === DEFAULT_FONT_ID.mono &&
    scale === DEFAULT_SCREEN_SCALE &&
    leading === DEFAULT_READING_LEADING &&
    tracking === DEFAULT_READING_TRACKING &&
    align === DEFAULT_READING_ALIGN &&
    width === DEFAULT_READING_WIDTH &&
    weight === DEFAULT_READING_WEIGHT;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Typography</h3>
        <p className="text-[11px] text-[var(--text-muted)]">
          Choose the interface and code fonts and the overall text size. Changes apply immediately.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <FontField slot="sans" label="Interface" options={SANS_OPTIONS} value={sansId} onChange={(id) => select("sans", id)} />
        <FontField slot="mono" label="Code &amp; terminal" options={MONO_OPTIONS} value={monoId} onChange={(id) => select("mono", id)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Text size</label>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Scale all text and UI.</p>
          <div className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
            {SCREEN_SCALE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTextSize(option)}
                aria-pressed={scale === option}
                aria-label={`Text size ${option}%`}
                className={`focus-ring min-w-12 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  scale === option
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                {option}%
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Line spacing</label>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Spacing for reading text — chat, library, and memory.</p>
          <div className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
            {READING_LEADING_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLineSpacing(option)}
                aria-pressed={leading === option}
                aria-label={`Line spacing ${LEADING_LABEL[option]}`}
                className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  leading === option
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                {LEADING_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Letter spacing</label>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Tracking for reading text — chat, library, and memory.</p>
          <div className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
            {READING_TRACKING_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLetterSpacing(option)}
                aria-pressed={tracking === option}
                aria-label={`Letter spacing ${TRACKING_LABEL[option]}`}
                className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  tracking === option
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                {TRACKING_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Text alignment</label>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Alignment for reading text — chat, library, and memory.</p>
          <div className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
            {READING_ALIGN_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTextAlign(option)}
                aria-pressed={align === option}
                aria-label={`Text alignment ${ALIGN_LABEL[option]}`}
                className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  align === option
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                {ALIGN_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Max reading width</label>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Caps line length for reading text — chat, library, and memory.</p>
          <div className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
            {READING_WIDTH_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReadingWidth(option)}
                aria-pressed={width === option}
                aria-label={`Max reading width ${WIDTH_LABEL[option]}`}
                className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  width === option
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                {WIDTH_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Font weight</label>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Base weight for reading text — chat, library, and memory.</p>
          <div className="flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5">
            {READING_WEIGHT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFontWeight(option)}
                aria-pressed={weight === option}
                aria-label={`Font weight ${WEIGHT_LABEL[option]}`}
                className={`focus-ring rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  weight === option
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                {WEIGHT_LABEL[option]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={reset}
          disabled={isDefault}
          className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Reset to default
        </button>
      </div>
    </section>
  );
}
