import assert from "node:assert/strict";
const SCREEN_SCALES_EXPECTED = [100, 105, 125, 150] as const;

import {
  DEFAULT_SCREEN_SCALE,
  SCREEN_SCALE_OPTIONS,
  normalizeScreenScale,
  stepScreenScale,
} from "./screen-magnification.ts";

assert.deepEqual(
  SCREEN_SCALE_OPTIONS,
  [100, 105, 125, 150],
  "Screen magnification should expose the expected scale ladder",
);

// The first step off the default is a nudge, not a jump: 110 read as dramatic
// in use, which is the whole reason this ladder changed.
assert.equal(stepScreenScale(100, 1), 105, "the first step up is gentle");

assert.equal(normalizeScreenScale("125"), 125);
assert.equal(normalizeScreenScale(150), 150);
assert.equal(normalizeScreenScale("999"), DEFAULT_SCREEN_SCALE);
assert.equal(normalizeScreenScale("nope"), DEFAULT_SCREEN_SCALE);

assert.equal(stepScreenScale(105, 1), 125);
assert.equal(stepScreenScale(150, 1), 150);
assert.equal(stepScreenScale(125, -1), 105);
assert.equal(stepScreenScale(100, -1), 100);

// Migration, and the reason it exists: normalizeScreenScale answers anything
// outside the ladder with the DEFAULT, so without this a user already on 110
// would come back at 100 with their magnification silently gone. Losing an
// accessibility setting is worse than the step it was on being coarse.
assert.equal(normalizeScreenScale(110), 105, "a legacy 110 lands on the nearest surviving step");
assert.equal(normalizeScreenScale("110"), 105, "including when it comes back from storage as a string");
assert.notEqual(normalizeScreenScale(110), DEFAULT_SCREEN_SCALE, "and is never quietly reset to 100");


// The ladder exists TWICE — SCREEN_SCALE_OPTIONS here and SCREEN_SCALES in
// preferences-schema.ts, which sits underneath this module and so cannot
// import it. Two hand-kept copies drift; this is the thing that notices.
{
  const schema = await import("./preferences-schema.ts");
  const declared = /const SCREEN_SCALES = \[([^\]]+)\]/.exec(
    (await import("node:fs")).readFileSync(
      new URL("./preferences-schema.ts", import.meta.url), "utf8",
    ),
  );
  assert.ok(declared, "preferences-schema still declares a SCREEN_SCALES ladder");
  const schemaLadder = declared[1].split(",").map((n) => Number(n.trim()));
  assert.deepEqual(
    schemaLadder,
    [...SCREEN_SCALES_EXPECTED],
    "the preferences schema's ladder matches the one the UI offers",
  );
  void schema;
}

console.log("screen-magnification.test.ts OK (ladder parity checked)");
