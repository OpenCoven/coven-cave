// @ts-nocheck
import assert from "node:assert/strict";

const { codeTablistKeyTarget } = await import("./code-tablist-keys.ts");

// Left and Right move one tab and wrap at both ends.
assert.equal(codeTablistKeyTarget({ key: "ArrowRight" }, 0, 3), 1);
assert.equal(codeTablistKeyTarget({ key: "ArrowRight" }, 2, 3), 0);
assert.equal(codeTablistKeyTarget({ key: "ArrowLeft" }, 0, 3), 2);
assert.equal(codeTablistKeyTarget({ key: "ArrowLeft" }, 2, 3), 1);

// Home and End jump to the ends.
assert.equal(codeTablistKeyTarget({ key: "Home" }, 2, 3), 0);
assert.equal(codeTablistKeyTarget({ key: "End" }, 0, 3), 2);

// Other keys are not tab moves: Tab must leave the strip, Enter activates.
assert.equal(codeTablistKeyTarget({ key: "Tab" }, 0, 3), null);
assert.equal(codeTablistKeyTarget({ key: "Enter" }, 0, 3), null);
assert.equal(codeTablistKeyTarget({ key: "ArrowDown" }, 0, 3), null);

// A modified arrow belongs to a shortcut or the OS, never to the strip.
assert.equal(codeTablistKeyTarget({ key: "ArrowRight", altKey: true }, 0, 3), null);
assert.equal(codeTablistKeyTarget({ key: "ArrowLeft", ctrlKey: true }, 1, 3), null);
assert.equal(codeTablistKeyTarget({ key: "Home", metaKey: true }, 1, 3), null);

// An empty strip or an index outside it has no target.
assert.equal(codeTablistKeyTarget({ key: "ArrowRight" }, 0, 0), null);
assert.equal(codeTablistKeyTarget({ key: "ArrowRight" }, -1, 3), null);
assert.equal(codeTablistKeyTarget({ key: "ArrowRight" }, 3, 3), null);
