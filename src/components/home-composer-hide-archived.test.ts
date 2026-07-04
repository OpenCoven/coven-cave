// @ts-nocheck
//
// Guard: the home-composer "new session" surface must hide archived familiars
// from the picker dropdown AND default to the first non-archived familiar
// when the user has not explicitly selected one yet.
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

// 3. Builds a non-archived list and uses it for both the default selection
//    and the dropdown options.
assert.match(
  source,
  /const\s+visibleFamiliars\s*=/,
  "HomeComposer should derive a visibleFamiliars list (non-archived)",
);

assert.match(
  source,
  /visibleFamiliars[\s\S]{0,200}?!\s*\(.*archivedFamiliars.*\)/,
  "visibleFamiliars should be filtered by archive state",
);

// 4. Default selection picks first non-archived familiar — not familiars[0].
assert.doesNotMatch(
  source,
  /selectedFamiliarId\s*=\s*activeFamiliarId\s*\?\?\s*familiars\[0\]\?\.id/,
  "HomeComposer should not default to familiars[0] (could be archived); use first visible familiar instead",
);

assert.match(
  source,
  /visibleFamiliars\[0\]\?\.id/,
  "HomeComposer selectedFamiliarId fallback should be visibleFamiliars[0]?.id (first non-archived familiar)",
);

// 4a. If the active familiar is archived, fall through to the first visible
//     one so the custom select's value matches an option in the DOM.
assert.match(
  source,
  /activeIsArchived/,
  "HomeComposer should check whether activeFamiliarId points at an archived familiar",
);

// 5. Dropdown renders visibleFamiliars, not raw familiars.
assert.match(
  source,
  /visibleFamiliars\.map\(\(familiar\)\s*=>\s*\{[\s\S]{0,500}value:\s*familiar\.id[\s\S]{0,500}label:\s*familiar\.display_name/,
  "HomeComposer dropdown should build custom select options from visibleFamiliars (non-archived only)",
);

// 6. The empty-state check should also reflect that there might be zero visible
//    familiars even if there are archived ones — guard that the disabled-when-
//    empty check uses the visible list.
assert.match(
  source,
  /disabled=\{visibleFamiliars\.length\s*===\s*0\s*\|\|\s*sending\}/,
  "HomeComposer dropdown should be disabled when there are no visible (non-archived) familiars",
);

console.log("home-composer-hide-archived.test.ts: ok");
