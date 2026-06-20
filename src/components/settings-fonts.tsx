"use client";

import { type ReactNode, useEffect, useState } from "react";
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
import {
  DEFAULT_READING_HYPHENS,
  READING_HYPHENS_OPTIONS,
  applyReadingHyphens,
  readReadingHyphens,
  type ReadingHyphens,
} from "@/lib/reading-hyphens";
import {
  DEFAULT_READING_DROPCAP,
  READING_DROPCAP_OPTIONS,
  applyReadingDropcap,
  readReadingDropcap,
  type ReadingDropcap,
} from "@/lib/reading-dropcap";
import {
  CLOCK_LABEL,
  CLOCK_OPTIONS,
  DATE_LABEL,
  DATE_OPTIONS,
  setClockFormat,
  setDateFormat,
  useDateTimePrefs,
} from "@/lib/datetime-format";

const DROPCAP_LABEL: Record<ReadingDropcap, string> = {
  off: "Off",
  on: "On",
};

const WIDTH_LABEL: Record<ReadingWidth, string> = {
  full: "Full",
  medium: "Medium",
  narrow: "Narrow",
};

const HYPHENS_LABEL: Record<ReadingHyphens, string> = {
  off: "Off",
  on: "On",
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

// Shared segmented-control styling, hoisted so each option group stays terse.
const segWrap =
  "flex w-fit shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5";

function segBtn(active: boolean, extra = ""): string {
  return `focus-ring ${extra} rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
    active
      ? "bg-[var(--accent-presence)] text-white"
      : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
  }`;
}

// Compact label-left / control-right row used to group the reading-text controls,
// which all share one caption instead of repeating it per control.
function ReadingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</div>
        {hint ? <div className="text-[11px] text-[var(--text-muted)]">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

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
  const [hyphens, setHyphens] = useState<ReadingHyphens>(DEFAULT_READING_HYPHENS);
  const [dropcap, setDropcap] = useState<ReadingDropcap>(DEFAULT_READING_DROPCAP);
  // Chat timestamp format prefs come straight from the reactive store (no local
  // mirror needed) — the segmented controls write through to it on click.
  const dtPrefs = useDateTimePrefs();

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
    setHyphens(readReadingHyphens());
    setDropcap(readReadingDropcap());
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

  const setHyphenation = (next: ReadingHyphens) => {
    setHyphens(next);
    applyReadingHyphens(next);
  };

  const setDropCap = (next: ReadingDropcap) => {
    setDropcap(next);
    applyReadingDropcap(next);
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
    setHyphenation(DEFAULT_READING_HYPHENS);
    setDropCap(DEFAULT_READING_DROPCAP);
  };

  const isDefault =
    sansId === DEFAULT_FONT_ID.sans &&
    monoId === DEFAULT_FONT_ID.mono &&
    scale === DEFAULT_SCREEN_SCALE &&
    leading === DEFAULT_READING_LEADING &&
    tracking === DEFAULT_READING_TRACKING &&
    align === DEFAULT_READING_ALIGN &&
    width === DEFAULT_READING_WIDTH &&
    weight === DEFAULT_READING_WEIGHT &&
    hyphens === DEFAULT_READING_HYPHENS &&
    dropcap === DEFAULT_READING_DROPCAP;

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Typography</h3>
        <p className="text-[11px] text-[var(--text-muted)]">
          Choose the interface and code fonts and how text is sized. Changes apply immediately.
        </p>
      </div>

      {/* Fonts — paired side by side, each with a live preview. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FontField slot="sans" label="Interface" options={SANS_OPTIONS} value={sansId} onChange={(id) => select("sans", id)} />
        <FontField slot="mono" label="Code &amp; terminal" options={MONO_OPTIONS} value={monoId} onChange={(id) => select("mono", id)} />
      </div>

      {/* Text size — the one control that scales the whole UI, not just prose. */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">Text size</label>
        <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">Scale all text and UI.</p>
        <div className={segWrap}>
          {SCREEN_SCALE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTextSize(option)}
              aria-pressed={scale === option}
              aria-label={`Text size ${option}%`}
              className={segBtn(scale === option, "min-w-12")}
            >
              {option}%
            </button>
          ))}
        </div>
      </div>

      {/* Reading text — one shared caption, then compact label/control rows. */}
      <div className="flex flex-col gap-2">
        <div>
          <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">Reading text</h4>
          <p className="text-[11px] text-[var(--text-muted)]">Applies to chat, library, and memory.</p>
        </div>
        <div className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] px-3">
          <ReadingRow label="Line spacing">
            <div className={segWrap}>
              {READING_LEADING_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLineSpacing(option)}
                  aria-pressed={leading === option}
                  aria-label={`Line spacing ${LEADING_LABEL[option]}`}
                  className={segBtn(leading === option)}
                >
                  {LEADING_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Letter spacing">
            <div className={segWrap}>
              {READING_TRACKING_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLetterSpacing(option)}
                  aria-pressed={tracking === option}
                  aria-label={`Letter spacing ${TRACKING_LABEL[option]}`}
                  className={segBtn(tracking === option)}
                >
                  {TRACKING_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Text alignment">
            <div className={segWrap}>
              {READING_ALIGN_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTextAlign(option)}
                  aria-pressed={align === option}
                  aria-label={`Text alignment ${ALIGN_LABEL[option]}`}
                  className={segBtn(align === option)}
                >
                  {ALIGN_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Max reading width">
            <div className={segWrap}>
              {READING_WIDTH_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReadingWidth(option)}
                  aria-pressed={width === option}
                  aria-label={`Max reading width ${WIDTH_LABEL[option]}`}
                  className={segBtn(width === option)}
                >
                  {WIDTH_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Font weight">
            <div className={segWrap}>
              {READING_WEIGHT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFontWeight(option)}
                  aria-pressed={weight === option}
                  aria-label={`Font weight ${WEIGHT_LABEL[option]}`}
                  className={segBtn(weight === option)}
                >
                  {WEIGHT_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Hyphenation" hint="Pairs well with Justify.">
            <div className={segWrap}>
              {READING_HYPHENS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setHyphenation(option)}
                  aria-pressed={hyphens === option}
                  aria-label={`Hyphenation ${HYPHENS_LABEL[option]}`}
                  className={segBtn(hyphens === option)}
                >
                  {HYPHENS_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Drop cap" hint="Library documents only.">
            <div className={segWrap}>
              {READING_DROPCAP_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDropCap(option)}
                  aria-pressed={dropcap === option}
                  aria-label={`Drop cap ${DROPCAP_LABEL[option]}`}
                  className={segBtn(dropcap === option)}
                >
                  {DROPCAP_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
        </div>
      </div>

      {/* Date & time — the Clock setting applies to every time shown in the app
          (calendar, capabilities, debug, …); the Date format applies to the chat
          message timestamp, where model/cwd/duration used to sit (now in debug). */}
      <div className="flex flex-col gap-2">
        <div>
          <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">Date &amp; time</h4>
          <p className="text-[11px] text-[var(--text-muted)]">
            Clock applies across the app; the date format applies to chat message timestamps.
          </p>
        </div>
        <div className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] px-3">
          <ReadingRow label="Clock" hint="Across the app">
            <div className={segWrap}>
              {CLOCK_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setClockFormat(option)}
                  aria-pressed={dtPrefs.clock === option}
                  aria-label={`Clock ${CLOCK_LABEL[option]}`}
                  className={segBtn(dtPrefs.clock === option)}
                >
                  {CLOCK_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
          <ReadingRow label="Date" hint="Chat messages">
            <div className={segWrap}>
              {DATE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDateFormat(option)}
                  aria-pressed={dtPrefs.date === option}
                  aria-label={`Date ${DATE_LABEL[option]}`}
                  className={segBtn(dtPrefs.date === option)}
                >
                  {DATE_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
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
