// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-switcher.tsx", import.meta.url), "utf8");
const globals = [
  readFileSync(new URL("../styles/globals/desktop-chrome.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/globals/shell-responsive.css", import.meta.url), "utf8"),
].join("\n");

// Trigger is an account-style profile/avatar button: the active familiar's
// avatar (or an "all" glyph), optional visible name, and a reply-needed dot —
// opening a dialog menu.
assert.match(
  source,
  /className=\{`familiar-switcher__trigger focus-ring\$\{labeled \? " familiar-switcher__trigger--labeled" : ""\}`\}[\s\S]*aria-haspopup="dialog"/,
  "renders a profile-style trigger that opens a dialog menu",
);
assert.match(
  source,
  /active && !multiScope \?\s*\(\s*<FamiliarAvatar familiar=\{active\} size="sm" \/>\s*\) : \(\s*<Icon name="ph:sparkle"/,
  "trigger shows the active familiar's avatar; the all scope and a ≥2 multiselect fall back to the sparkle glyph",
);
assert.match(
  source,
  /labeled \? <span className="familiar-switcher__trigger-label">\{triggerText\}<\/span> : null/,
  "labeled trigger shows the scope text (name, All familiars, or the multiselect count)",
);
assert.match(
  source,
  /multiScope\s*\? `\$\{multiScope\.size\} familiars`/,
  "a ≥2 multiselect summarizes as a count on the trigger",
);
assert.match(
  source,
  /singleRequired\s*\? "Choose familiar"\s*: aggregateLabel/,
  "a required single-familiar picker keeps Choose familiar while aggregate scope uses aggregateLabel",
);
assert.match(
  source,
  /familiar-switcher__trigger-caret/,
  "the labeled trigger carries a dropdown caret (it reads as a selector)",
);
assert.match(
  source,
  /anyNeedsReply \? <span className="familiar-switcher__unread"/,
  "trigger surfaces an unread dot when any familiar needs a reply",
);

// Menu: an "All familiars" option (null scope) plus each familiar.
assert.match(
  source,
  /onClick=\{\(\) => \{ onSelectFamiliar\(null\); setOpen\(false\); \}\}/,
  "the All option scopes to all familiars (null)",
);
assert.match(
  source,
  /onClick=\{\(e\) => pickFamiliar\(f\.id, e\)\}/,
  "picking a familiar routes through pickFamiliar (solo vs multi)",
);
// Multiselect: the checkbox zone (or ⌘/Ctrl-click) toggles scope membership and
// keeps the menu open; a plain click solo-selects and closes.
assert.match(
  source,
  /e\.metaKey \|\| e\.ctrlKey \|\|\s*Boolean\(\(e\.target as HTMLElement\)\.closest\("\.familiar-switcher__checkbox"\)\)/,
  "the checkbox zone and ⌘/Ctrl-click both mean multi",
);
assert.match(source, /if \(!multi\) setOpen\(false\);/, "multi picks keep the menu open for more toggles");
assert.match(
  source,
  /aria-multiselectable=\{singleRequired \? undefined : true\}/,
  "the listbox announces multiselect except on single-familiar surfaces",
);
assert.match(
  source,
  /className=\{`familiar-switcher__checkbox\$\{isActive \? " is-checked" : ""\}`\}/,
  "each row renders its checkbox zone with checked state",
);

// Presence + reply signals preserved from the retired dock.
assert.match(
  source,
  /computePresence\(\{/,
  "rows compute presence for the status dot",
);
assert.match(
  source,
  /className=\{`familiar-switcher__presence \$\{presence\.dot\}`\}/,
  "rows render a presence dot",
);
assert.match(
  source,
  /needsReply \? <span className="familiar-switcher__option-unread"/,
  "rows show a reply-needed badge",
);

// Comprehensive profile editing: header "Edit profile" + per-row gear open Studio.
assert.match(
  source,
  /openFamiliarStudio\(active\.id, "identity"\)/,
  "header Edit profile opens the active familiar's Studio",
);
assert.match(
  source,
  /className="familiar-switcher__gear"[\s\S]*openFamiliarStudio\(f\.id, "identity"\)/,
  "each row has a gear that opens that familiar's Studio",
);

// Pinning now lives only in Settings → Appearance (Familiar switcher → pin
// order), the single source of truth. The dropdown rows no longer carry a
// per-row pin toggle.
assert.doesNotMatch(source, /togglePin|familiar-switcher__pin|useFamiliarPins/, "the dropdown has no per-row pin toggle (pinning moved to Settings)");

// Footer: a prominent full-width Summon invitation, with manage (Studio list
// view) and reorder as quieter actions beneath it (cave-6p5l).
assert.match(
  source,
  /requestSummonFamiliar\(\)/,
  "Summon routes to the Summoning Circle on the Familiars surface (cave-3em5)",
);
assert.doesNotMatch(
  source,
  /cave:onboarding-open/,
  "Summon must NOT open the onboarding wizard — it stops at infrastructure and cannot create familiars (cave-3em5)",
);
assert.match(
  source,
  /className="familiar-switcher__summon focus-ring"[\s\S]{0,200}ph:magic-wand-fill[\s\S]{0,100}Summon familiar/,
  "the footer leads with a full-width Summon familiar button wearing the circle's wand",
);
assert.match(source, /openFamiliarStudioListView\(\)/, "Manage opens the familiars manager (Settings → Familiars)");
assert.match(source, /setReordering\(true\)/, "Reorder enables drag mode");
assert.match(source, /setFamiliarOrder\(arrayMove\(/, "reorder persists the new familiar order");

// Rows read as a clean dropdown: the checkbox zone keeps its slot but only
// fades in on hover/focus, when checked, or while a multiselect scope is live.
assert.match(
  source,
  /data-multi=\{!singleRequired && multiScope \? "true" : undefined\}/,
  "the list flags a live multiselect scope so CSS can keep all checkboxes visible",
);
assert.match(
  globals,
  /\.familiar-switcher__checkbox \{/,
  "checkbox zones rest invisible so rows read as a plain dropdown",
);
assert.match(
  globals,
  /opacity:\s*0;/,
  "checkbox zones start hidden",
);
assert.match(
  globals,
  /\.familiar-switcher__checkbox\.is-checked,/,
  "checked rows still share the reveal selector",
);
assert.match(
  globals,
  /\.familiar-switcher__list\[data-multi\] \.familiar-switcher__checkbox \{/,
  "a live multiselect keeps checkbox zones visible",
);
assert.match(
  globals,
  /opacity:\s*1;/,
  "checked rows, hovered rows, and a live multiselect reveal the checkbox",
);
assert.match(
  globals,
  /\.familiar-switcher__summon \{[\s\S]*?width: 100%;[\s\S]*?border: 1px dashed color-mix\(in oklch, var\(--accent-presence\)/,
  "the Summon button is a full-width dashed invitation tinted with presence",
);

// Styling hooks exist.
assert.match(globals, /\.familiar-switcher__trigger \{/, "trigger has dedicated styling");
assert.match(
  globals,
  /\.familiar-switcher__trigger\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/,
  "desktop trigger should match the square top-bar icon button dimensions",
);
assert.match(
  globals,
  /\.familiar-switcher__trigger--labeled\s*\{[\s\S]*?width:\s*auto;[\s\S]*?max-width:\s*180px;/,
  "labeled trigger expands to fit the familiar name while staying bounded",
);
assert.match(
  globals,
  /@media \(max-width: 1023px\)[\s\S]*\.top-bar__actions \.familiar-switcher__trigger\s*\{[\s\S]*?width:\s*var\(--touch-target\);[\s\S]*?height:\s*var\(--touch-target\)/,
  "mobile trigger should match the row's shared touch-target icon height",
);
assert.match(globals, /\.familiar-switcher__option \{/, "menu options have dedicated styling");

// ── Stage 1 Task 4: aggregateLabel, aggregateDescription, disabled props ────
// All props are optional; existing callers retain existing behavior.
assert.match(
  source,
  /aggregateLabel\??: string/,
  "FamiliarSwitcher accepts optional aggregateLabel prop",
);
assert.match(
  source,
  /aggregateDescription\??: string/,
  "FamiliarSwitcher accepts optional aggregateDescription prop",
);
assert.match(
  source,
  /disabled\??: boolean/,
  "FamiliarSwitcher accepts optional disabled prop",
);
// Default copy: "All familiars" must come from aggregateLabel with default
assert.match(
  source,
  /aggregateLabel\s*=\s*"All familiars"/,
  "aggregateLabel default remains declared at destructuring",
);
// Rendered header name and list option use aggregateLabel variable
assert.match(
  source,
  /\{aggregateLabel\}/,
  "rendered header name and/or list option display aggregateLabel",
);
// Header role text: aggregateDescription ?? fallback
assert.match(
  source,
  /aggregateDescription \?\? `\$\{familiars\.length\} in your coven`/,
  "header role text uses aggregateDescription when provided, falls back to count",
);
// Aggregate trigger aria-label uses aggregateLabel
assert.match(
  source,
  /Switch familiar — scope: \$\{aggregateLabel\.toLowerCase\(\)\}/,
  "aggregate trigger accessible label uses aggregateLabel",
);
// disabled prop forwarded to trigger button
assert.match(
  source,
  /disabled=\{disabled\}/,
  "disabled prop is forwarded to the trigger button",
);

// ── Stage 1 Task 4: disabled-open gating and state reset ────────────────────
assert.match(
  source,
  /import \{ useEffect[^}]*\} from "react"/,
  "useEffect is imported for the disabled-open gate",
);
assert.match(
  source,
  /const popoverOpen = open && !disabled;/,
  "popoverOpen is gated at render time so a disabled trigger is inaccessible immediately",
);
assert.match(
  source,
  /aria-expanded=\{popoverOpen\}/,
  "the trigger reports the render-time open state, not the raw open flag",
);
assert.match(
  source,
  /<Popover[\s\S]{0,120}open=\{popoverOpen\}/,
  "Popover visibility follows the render-time gated open state",
);
assert.match(
  source,
  /if \(disabled && next\) return;/,
  "onOpenChange will not reopen while disabled",
);
assert.match(
  source,
  /useEffect\(\s*\(\) => \{[\s\S]{0,300}if \(disabled\)[\s\S]{0,200}setOpen\(false\)/,
  "when disabled becomes true, the effect still clears stale open state",
);
assert.match(
  source,
  /if \(disabled\)[\s\S]{0,200}setOpen\(false\)[\s\S]{0,200}setReordering\(false\)/,
  "disabled also clears reordering state so re-enabling starts from a clean menu position",
);
assert.match(
  source,
  /if \(disabled\)[\s\S]{0,200}setQuery\(""\)/,
  "disabled clears query state so the filter does not persist across enable/disable cycles",
);
assert.match(
  source,
  /}, \[disabled\]\)/,
  "the disabled-close effect depends only on [disabled] — not [disabled, open] — so it fires only on prop change",
);

assert.match(
  source,
  /if \(disabled && next\) return;\s*\n\s*setOpen\(next\)/,
  "onOpenChange guard + setOpen(next) is semantically equivalent to setOpen(!disabled && next)",
);

console.log("familiar-switcher.test.ts: ok");
