// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./settings-fonts.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

assert.match(src, /FONT_PAIRS/, "FontSettings reads curated FONT_PAIRS");
assert.doesNotMatch(src, /SANS_OPTIONS/, "does not expose an independent sans picker");
assert.doesNotMatch(src, /MONO_OPTIONS/, "does not expose an independent mono picker");
assert.match(src, /readFontPairPref/, "loads the saved curated font pair");
assert.match(src, /writeFontPairPref/, "persists font pairs as a unit");
assert.match(src, /applyFontPair/, "applies font pairs as a unit");
assert.match(src, /StandardSelect/, "renders the shared custom select");
assert.doesNotMatch(src, /<select/, "does not render native selects");
assert.match(src, /import \{ Button \}/, "font settings actions use the shared Button primitive");
assert.doesNotMatch(src, /<button\b/, "font settings should not hand-roll button controls");
assert.match(src, /rounded-\[var\(--radius-control\)\]/, "font settings controls use the shared control radius token");
assert.doesNotMatch(src, /rounded-md/, "font settings controls do not hard-code Tailwind's md radius");
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "font settings controls do not hard-code rounded classes",
);
assert.match(src, /fontStack\(/, "preview rendered with fontStack");
assert.match(src, /DEFAULT_FONT_PAIR_ID/, "reset targets the default pair");
assert.match(src, /Reset/, "exposes a reset control");
assert.match(src, /Typography pair/, "renders a single pair selector");
assert.match(
  src,
  /label="Typography pair"[\s\S]*?style=\{\{ width: "min\(100%, 300px\)", maxWidth: "100%" \}\}/,
  "typography pair selector uses a responsive width that fits curated pair labels",
);
assert.match(src, /Interface/, "keeps the interface preview");
assert.match(src, /Code &amp; terminal/, "keeps the code and terminal preview");

assert.match(shell, /import \{ FontSettings \} from "\.\/settings-fonts"/, "shell imports FontSettings");
assert.match(shell, /<FontSettings\s*\/>/, "AppearanceSection renders <FontSettings />");

// ── The selected segment must actually LOOK selected (cave-q42g) ─────────────
// SegmentButton renders through Button variant="ghost"; .ui-btn--ghost is
// UNLAYERED CSS (background: transparent + its own :hover), and unlayered rules
// beat Tailwind's layered utilities unconditionally — so the active accent
// classes never painted and Reading text / Date & time selections were
// invisible (Corner radius, on the shared Segmented's plain <button>, was
// fine). The cure is the mode-toggle precedent: a scoped unlayered pressed-
// state rule that wins the background back.
assert.match(
  src,
  /className=\{`settings-segment \$\{segBtn\(active, extra\)\}`\}/,
  "SegmentButton carries the settings-segment class the pressed-state CSS keys on",
);
{
  const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(
    globals,
    /\.settings-segment\[aria-pressed="true"\] \{\s*\n\s*background: var\(--accent-presence\) !important;\s*\n\s*color: var\(--accent-presence-foreground\) !important;/,
    "the pressed segment's accent fill is unlayered CSS — Button/ghost's unlayered transparent background beats Tailwind utilities, so utilities alone cannot express the selected state",
  );
  assert.match(
    globals,
    /\.settings-segment\[aria-pressed="true"\]:hover \{/,
    "hover on the selected segment keeps the accent fill (ghost's own hover would repaint it)",
  );
}

// The component must apply the saved fonts on mount (the boot script that would
// otherwise do it pre-paint is not mounted), so the rendered font matches the
// persisted selection after a reload — not just after a user change.
assert.match(
  src,
  /useEffect\(\(\) => \{[\s\S]*?readFontPairPref\([\s\S]*?writeFontPairPref\([\s\S]*?applyFontPair\([\s\S]*?\}, \[\]\)/,
  "mount effect normalizes and applies the saved font pair",
);

// Text size control (reframed Screen magnification) lives in Typography.
assert.match(src, /Text size/, "renders a Text size control");
assert.match(src, /SCREEN_SCALE_OPTIONS/, "uses the shared scale ladder");
assert.match(src, /applyScreenScale/, "applies the scale via the shared helper");
assert.match(src, /aria-pressed=\{scale === option\}/, "scale buttons expose selected state");
// Reset restores text size to the default too, not just the fonts.
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_SCREEN_SCALE[\s\S]*?\}/,
  "reset restores the default text size",
);

// Line spacing control (reading line-height for .cave-md surfaces).
assert.match(src, /Line spacing/, "renders a Line spacing control");
assert.match(src, /READING_LEADING_OPTIONS/, "uses the reading-leading ladder");
assert.match(src, /applyReadingLeading/, "applies line spacing via the shared helper");
assert.match(src, /aria-pressed=\{leading === option\}/, "line-spacing buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_LEADING[\s\S]*?\}/,
  "reset restores the default line spacing",
);

// Letter spacing control (reading tracking for .cave-md surfaces).
assert.match(src, /Letter spacing/, "renders a Letter spacing control");
assert.match(src, /READING_TRACKING_OPTIONS/, "uses the reading-tracking ladder");
assert.match(src, /applyReadingTracking/, "applies letter spacing via the shared helper");
assert.match(src, /aria-pressed=\{tracking === option\}/, "letter-spacing buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_TRACKING[\s\S]*?\}/,
  "reset restores the default letter spacing",
);

// Text alignment control (reading text-align for .cave-md surfaces).
assert.match(src, /Text alignment/, "renders a Text alignment control");
assert.match(src, /READING_ALIGN_OPTIONS/, "uses the reading-align ladder");
assert.match(src, /applyReadingAlign/, "applies text alignment via the shared helper");
assert.match(src, /aria-pressed=\{align === option\}/, "alignment buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_ALIGN[\s\S]*?\}/,
  "reset restores the default text alignment",
);

// Max reading width control (caps .cave-md prose measure).
assert.match(src, /Max reading width/, "renders a Max reading width control");
assert.match(src, /READING_WIDTH_OPTIONS/, "uses the reading-width ladder");
assert.match(src, /applyReadingWidth/, "applies reading width via the shared helper");
assert.match(src, /aria-pressed=\{width === option\}/, "reading-width buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_WIDTH[\s\S]*?\}/,
  "reset restores the default reading width",
);

// Font weight control (base weight of .cave-md prose).
assert.match(src, /Font weight/, "renders a Font weight control");
assert.match(src, /READING_WEIGHT_OPTIONS/, "uses the reading-weight ladder");
assert.match(src, /applyReadingWeight/, "applies font weight via the shared helper");
assert.match(src, /aria-pressed=\{weight === option\}/, "font-weight buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_WEIGHT[\s\S]*?\}/,
  "reset restores the default font weight",
);

// Hyphenation control (.cave-md prose).
assert.match(src, /Hyphenation/, "renders a Hyphenation control");
assert.match(src, /READING_HYPHENS_OPTIONS/, "uses the reading-hyphens ladder");
assert.match(src, /applyReadingHyphens/, "applies hyphenation via the shared helper");
assert.match(src, /aria-pressed=\{hyphens === option\}/, "hyphenation buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_HYPHENS[\s\S]*?\}/,
  "reset restores the default hyphenation",
);

assert.match(src, /Applies to chat and memory\./, "reading text copy should only name integrated app surfaces");
assert.doesNotMatch(src, /Applies to chat, library, and memory\./, "feature-branch Library should not appear in integrated Settings copy");
assert.doesNotMatch(src, /Drop cap|READING_DROPCAP|applyReadingDropcap/, "Library-only drop-cap controls stay out of integrated Settings");

console.log("settings-fonts.test.ts OK");
