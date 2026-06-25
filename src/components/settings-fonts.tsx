"use client";

import { type ReactNode, useEffect, useState } from "react";
import { SettingsGroup } from "@/components/ui/settings-group";
import {
  DEFAULT_FONT_PAIR_ID,
  FONT_PAIRS,
  fontPairById,
  fontOptionById,
  fontStack,
  type FontSlot,
} from "@/lib/font-catalog";
import { applyFontPair, readFontPairPref, writeFontPairPref } from "@/lib/font-storage";
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
  DENSITY_LABEL,
  DENSITY_OPTIONS,
  setClockFormat,
  setDateFormat,
  setDensityFormat,
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
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</div>
        {hint ? <div className="text-[11px] text-[var(--text-muted)]">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

// A single type specimen: a small caption (role · font name) over a live
// sample rendered in the selected font. Two of these stack inside one inset
// panel so the preview reads as a cohesive specimen sheet with no dead gutter.
function FontSpecimen({
  slot,
  label,
  fontId,
}: {
  slot: FontSlot;
  label: ReactNode;
  fontId: string;
}) {
  const opt = fontOptionById(fontId);
  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </span>
        <span className="truncate text-[11px] text-[var(--text-muted)]">· {opt?.label}</span>
      </div>
      <p
        className="mt-1 truncate text-[16px] leading-snug text-[var(--text-primary)]"
        style={{ fontFamily: opt ? fontStack(opt) : undefined }}
      >
        {PREVIEW[slot]}
      </p>
    </div>
  );
}

export function FontSettings() {
  const [pairId, setPairId] = useState<string>(DEFAULT_FONT_PAIR_ID);
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
    const pair = readFontPairPref();
    setPairId(pair.id);
    writeFontPairPref(pair.id);
    applyFontPair(pair.id);
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

  const selectPair = (id: string) => {
    const pair = fontPairById(id) ?? fontPairById(DEFAULT_FONT_PAIR_ID)!;
    setPairId(pair.id);
    writeFontPairPref(pair.id);
    applyFontPair(pair.id);
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
    selectPair(DEFAULT_FONT_PAIR_ID);
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
    pairId === DEFAULT_FONT_PAIR_ID &&
    scale === DEFAULT_SCREEN_SCALE &&
    leading === DEFAULT_READING_LEADING &&
    tracking === DEFAULT_READING_TRACKING &&
    align === DEFAULT_READING_ALIGN &&
    width === DEFAULT_READING_WIDTH &&
    weight === DEFAULT_READING_WEIGHT &&
    hyphens === DEFAULT_READING_HYPHENS &&
    dropcap === DEFAULT_READING_DROPCAP;
  const selectedPair = fontPairById(pairId) ?? fontPairById(DEFAULT_FONT_PAIR_ID)!;

  return (
    <section className="flex flex-col gap-5">
      <SettingsGroup
        label="Typography"
        description="Choose the interface and code fonts and how text is sized. Changes apply immediately."
      >
        {/* Pair selector — label-left / control-right, consistent with every
            other row in Typography (no wasted full-width row). */}
        <ReadingRow label="Typography pair" hint="Approved interface + code pairing.">
          <select
            id="typography-pair"
            className="gh-select"
            style={{ maxWidth: "260px" }}
            value={pairId}
            onChange={(e) => selectPair(e.target.value)}
            aria-label="Typography pair"
          >
            {FONT_PAIRS.map((pair) => (
              <option key={pair.id} value={pair.id}>
                {pair.label}
              </option>
            ))}
          </select>
        </ReadingRow>

        {/* Live specimen — one inset panel, both samples, no center gutter. */}
        <div className="px-4 py-3">
          <div className="overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] divide-y divide-[var(--border-hairline)]">
            <FontSpecimen slot="sans" label="Interface" fontId={selectedPair.sansId} />
            <FontSpecimen slot="mono" label={<>Code &amp; terminal</>} fontId={selectedPair.monoId} />
          </div>
        </div>

        {/* Text size — the one control that scales the whole UI, not just prose. */}
        <ReadingRow label="Text size" hint="Scales all text and UI.">
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
        </ReadingRow>
      </SettingsGroup>

      {/* Reading text — one shared caption, then compact label/control rows. */}
      <SettingsGroup label="Reading text" description="Applies to chat, library, and memory.">
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
      </SettingsGroup>

      {/* Date & time — the Clock setting applies to every time shown in the app
          (calendar, capabilities, debug, …); the Date format applies to the chat
          message timestamp, where model/cwd/duration used to sit (now in debug). */}
      <SettingsGroup
        label="Date & time"
        description="Clock applies across the app; the date format applies to chat message timestamps."
      >
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
          <ReadingRow label="Date" hint="Across the app">
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
          <ReadingRow label="Relative time" hint="Across the app">
            <div className={segWrap}>
              {DENSITY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDensityFormat(option)}
                  aria-pressed={dtPrefs.density === option}
                  aria-label={`Relative time ${DENSITY_LABEL[option]}`}
                  className={segBtn(dtPrefs.density === option)}
                >
                  {DENSITY_LABEL[option]}
                </button>
              ))}
            </div>
          </ReadingRow>
      </SettingsGroup>

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
