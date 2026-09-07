// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const palette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../styles/globals/primitives.css", import.meta.url), "utf8");

// Unit 7 accessibility: the expanded surface is a modal combobox/listbox
// with a focus trap, active descendant, focus return, live result counts,
// an alert/status announcement split, specific chip remove names, no
// status carried by color alone, and no new motion beyond the existing
// modal transitions + reduced-motion behavior.

// ── Modal combobox/listbox + focus trap ────────────────────────────────
assert.match(palette, /role="dialog"[\s\S]{0,120}?aria-modal="true"/, "the surface is a modal dialog");
assert.match(palette, /role="combobox"/, "the input is a combobox");
assert.match(palette, /role="listbox"/, "results are a listbox");
assert.match(palette, /useFocusTrap\(open, dialogRef/, "focus is trapped while open");
assert.match(palette, /aria-activedescendant=/, "the active descendant is visible to AT");

// ── Focus return ───────────────────────────────────────────────────────
// use-focus-trap saves the previously-focused element on activate and
// restores it on deactivate; the top-bar input is what opened the palette,
// so Escape/navigation lands focus back there.
assert.match(palette, /useFocusTrap\(open, dialogRef, \{ onEscape: closeWithState \}\)/, "focus trap drives Escape close + focus return");

// ── Live result counts + alert/status split ────────────────────────────
assert.match(palette, /role="status"[\s\S]{0,200}?globalResults\.length/, "live result counts are status announcements");
assert.match(palette, /globalError \? \([\s\S]{0,120}?role="alert"/, "provider failures use an alert");
assert.match(palette, /globalLoading \? \([\s\S]{0,120}?role="status"/, "warming uses a status announcement");
assert.match(palette, /globalPartial && !globalError[\s\S]{0,120}?role="status"/, "partial failures are announced as status");

// ── Chip remove buttons with specific accessible names ────────────────
assert.match(palette, /Remove scope \$\{scope\.label\}/, "scope chips name what they remove");
assert.match(palette, /Remove filter \$\{chipLabelFor\(filter\)\}/, "filter chips name what they remove");

// ── No status carried by color alone ──────────────────────────────────
// The session status dot carries a text aria-label; global result rows
// render status as text, never as a bare colored glyph.
assert.match(palette, /role="img"[\s\S]{0,120}?aria-label=\{\`\$\{row\.session\.status\} session\`\}/, "session status dots are labelled");
assert.match(palette, /row\.result\.status[\s\S]{0,40}?\$\{row\.result\.status\}/, "global rows show status as text");

// ── Motion: only existing modal transitions, reduced-motion respected ──
assert.match(palette, /animation:ui-modal-fade-in_var\(--duration-fast\)/, "the scrim reuses the existing modal fade");
assert.match(palette, /animation:ui-modal-enter_var\(--duration-base\)/, "the dialog reuses the existing modal enter");
assert.match(primitives, /prefers-reduced-motion: reduce/, "reduced-motion behavior exists for modal transitions");
assert.doesNotMatch(
  palette,
  /animation:[\s\S]{0,120}?(?:pulse|spin|bounce|slide|shake)/,
  "no new motion idioms beyond the modal transitions",
);

console.log("command-palette-a11y-global.test.ts: ok");
