// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-switcher.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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
assert.match(source, /aria-multiselectable="true"/, "the listbox announces multiselect");
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

// Footer: create (onboarding), manage (Studio list view), reorder.
assert.match(
  source,
  /new CustomEvent\("cave:onboarding-open"\)/,
  "New routes to the onboarding create flow (familiars are daemon-owned)",
);
assert.match(source, /openFamiliarStudioListView\(\)/, "Manage opens the Studio list view");
assert.match(source, /setReordering\(true\)/, "Reorder enables drag mode");
assert.match(source, /setFamiliarOrder\(arrayMove\(/, "reorder persists the new familiar order");

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

console.log("familiar-switcher.test.ts: ok");
