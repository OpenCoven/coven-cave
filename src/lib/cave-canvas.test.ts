// @ts-nocheck
import assert from "node:assert/strict";

import { sanitizePositions } from "./cave-canvas.ts";

// sanitizePositions is the trust boundary for everything that reaches disk or
// arrives over the PUT body — it must drop anything that isn't a finite point.

assert.deepEqual(
  sanitizePositions({ a: { x: 1, y: 2 }, b: { x: 0, y: -5 } }),
  { a: { x: 1, y: 2 }, b: { x: 0, y: -5 } },
  "well-formed finite points pass through",
);

assert.deepEqual(
  sanitizePositions({ art: { x: 10, y: 20, width: 640, height: 420 } }),
  { art: { x: 10, y: 20, width: 640, height: 420 } },
  "artifact positions may persist finite resized dimensions",
);

assert.deepEqual(sanitizePositions(null), {}, "null is coerced to an empty map");
assert.deepEqual(sanitizePositions([1, 2, 3]), {}, "arrays are rejected (positions is an object map)");
assert.deepEqual(sanitizePositions("nope"), {}, "primitives are rejected");

assert.deepEqual(
  sanitizePositions({
    good: { x: 3, y: 4 },
    goodSize: { x: 3, y: 4, width: 500, height: 300 },
    nanX: { x: NaN, y: 0 },
    infY: { x: 0, y: Infinity },
    nanWidth: { x: 1, y: 2, width: NaN, height: 300 },
    infHeight: { x: 1, y: 2, width: 500, height: Infinity },
    missing: { x: 1 },
    stringy: { x: "1", y: "2" },
    nested: { x: { z: 1 }, y: 2 },
    notObj: 5,
  }),
  { good: { x: 3, y: 4 }, goodSize: { x: 3, y: 4, width: 500, height: 300 } },
  "only finite numeric points and finite optional dimensions survive the mixed bag",
);

console.log("cave-canvas.test.ts ✓");
