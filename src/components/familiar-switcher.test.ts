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
  /active \?\s*\(\s*<FamiliarAvatar familiar=\{active\} size="sm" \/>\s*\) : \(\s*<Icon name="ph:sparkle"/,
  "trigger shows the active familiar's avatar, falling back to an all-scope glyph",
);
assert.match(
  source,
  /labeled \? <span className="familiar-switcher__trigger-label">\{active \? active\.display_name : "All familiars"\}<\/span> : null/,
  "labeled trigger shows the selected familiar name",
);
assert.doesNotMatch(
  source,
  /familiar-switcher__caret/,
  "trigger does not add a dropdown caret",
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
  /onClick=\{\(\) => \{ onSelectFamiliar\(f\.id\); setOpen\(false\); \}\}/,
  "picking a familiar scopes to its id",
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
