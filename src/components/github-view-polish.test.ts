// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./github-view.tsx", import.meta.url),
  "utf8",
);

// Inner GitHub <h2> and logo removed — the workspace breadcrumb already names the surface.
assert.doesNotMatch(
  source,
  /<h2 className="text-\[15px\] font-semibold">GitHub<\/h2>/,
  "inner GitHub h2 removed",
);
assert.doesNotMatch(
  source,
  /<Icon name="ph:github-logo" width=\{16\}/,
  "inner GitHub logo (header) removed (kept only inside the empty-state CTA)",
);

// Refresh button tooltip names the new shortcut.
assert.match(
  source,
  /title="Refresh \(⌘R\)"/,
  "refresh button tooltip includes ⌘R",
);

// Footer is no longer gated on `activity` — it always renders.
assert.doesNotMatch(
  source,
  /\{activity && \(\s*<footer/,
  "footer is no longer conditionally rendered on `activity`",
);
assert.match(
  source,
  /⌘R refresh · click a row to open in GitHub/,
  "footer carries the keyboard hint",
);

// ⌘R keydown handler wired.
assert.match(
  source,
  /e\.metaKey \|\| e\.ctrlKey/,
  "keydown handler checks meta or ctrl modifier",
);
assert.match(
  source,
  /e\.key !== "r" && e\.key !== "R"/,
  "keydown handler gates on the R key",
);
assert.match(
  source,
  /void fetchActivity\(\)/,
  "keydown handler triggers fetchActivity",
);
assert.match(
  source,
  /tag === "INPUT" \|\| tag === "TEXTAREA"/,
  "keydown handler skips when an input/textarea is focused",
);

// When a PAT is connected the button is icon-only (no text label); it keeps an
// aria-label for accessibility and only shows "Add PAT" text when not connected.
assert.doesNotMatch(
  source,
  /PAT connected</,
  "Connected PAT button drops its text label (icon only)",
);
assert.match(
  source,
  /aria-label=\{patStatus\?\.hasPat \? "GitHub PAT connected/,
  "Icon-only connected PAT button keeps an aria-label",
);
assert.match(
  source,
  /\{patStatus\?\.hasPat \? null : "Add PAT"\}/,
  "Disconnected state still shows the 'Add PAT' call to action",
);

console.log("github-view-polish.test.ts OK");
