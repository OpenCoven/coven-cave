// @ts-nocheck
//
// Guard: the home-composer "new session" surface must default to the first
// non-archived familiar when the previously-active one is archived. (The old
// home familiar picker is gone — the side panel owns selection — but the
// default used for sending must still skip archived familiars.)
//
// Archived familiars are tracked by `cave-familiar-archive.ts` (localStorage,
// per-Cave). Showing them in a "start a new chat" picker is a footgun — the
// user can't tell the agent is archived from the dropdown, and starting a new
// session against an archived familiar produces a confusing state.
//
// We assert against the source string rather than rendering React so this guard
// stays light and matches the existing home-composer.test.ts pattern.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const contextSource = await readFile(new URL("../lib/home-composer-context.ts", import.meta.url), "utf8");

// 1. Imports the archive hook.
assert.match(
  source,
  /useArchivedFamiliars/,
  "HomeComposer should import useArchivedFamiliars to know which familiars are archived",
);

assert.match(
  source,
  /from\s+["']@\/lib\/cave-familiar-archive["']/,
  "HomeComposer should import the archive hook from cave-familiar-archive",
);

// 2. Uses the hook in the component body.
assert.match(
  source,
  /const\s+archivedFamiliars\s*=\s*useArchivedFamiliars\(\)/,
  "HomeComposer should call useArchivedFamiliars() to read the archive map",
);

// 3. Delegates non-archived selection to the dedicated context boundary.
assert.match(
  source,
  /resolveHomeComposerFamiliar\(familiars, activeFamiliarId, archivedFamiliars\)/,
  "HomeComposer should resolve familiar selection through the archive-aware context helper",
);

assert.match(
  contextSource,
  /const\s+visibleFamiliars\s*=/,
  "The familiar context should derive a visibleFamiliars list (non-archived)",
);

assert.match(
  contextSource,
  /visibleFamiliars[\s\S]{0,200}?!\s*\(.*archivedFamiliars.*\)/,
  "The familiar context should filter visibleFamiliars by archive state",
);

// 4. Default selection picks first non-archived familiar — not familiars[0].
assert.doesNotMatch(
  contextSource,
  /selectedFamiliarId\s*=\s*activeFamiliarId\s*\?\?\s*familiars\[0\]\?\.id/,
  "The familiar context should not default to familiars[0] (could be archived)",
);

assert.match(
  contextSource,
  /visibleFamiliars\[0\]\?\.id/,
  "The familiar context fallback should be visibleFamiliars[0]?.id (first non-archived familiar)",
);

// 4a. If the active familiar is archived, fall through to the first visible
//     one so the custom select's value matches an option in the DOM.
assert.match(
  contextSource,
  /activeIsArchived/,
  "The familiar context should check whether activeFamiliarId points at an archived familiar",
);

// 5. The familiar picker itself is gone from home (selection lives in the side
//    panel), so no dropdown may render familiars — visibleFamiliars only feeds
//    the default-selection fallback above.
assert.doesNotMatch(
  source,
  /HomeSelect|Choose chat agent/,
  "HomeComposer should not render a familiar picker (side panel owns selection)",
);

console.log("home-composer-hide-archived.test.ts: ok");
