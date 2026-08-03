// Behavioral tests for the `/auto` mission status marker protocol
// (<coven:auto-status>), mirroring skill-blocks.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { extractAutoStatusMarkers } from "./auto-status-blocks.ts";

test("extract: marker becomes an update and leaves no raw tag", () => {
  const { visible, update } = extractAutoStatusMarkers(
    'Working.\n<coven:auto-status state="working" note="scanning src/lib" />\nMore.',
  );
  assert.deepEqual(update, { state: "working", note: "scanning src/lib" });
  assert.ok(!visible.includes("<coven:auto-status"));
  assert.match(visible, /Working\./);
  assert.match(visible, /More\./);
});

test("extract: repeated markers keep only the LAST state", () => {
  const { update } = extractAutoStatusMarkers(
    [
      '<coven:auto-status state="clarifying" note="need a target dir" />',
      '<coven:auto-status state="working" />',
      '<coven:auto-status state="done" note="fixed 3 failing tests" />',
    ].join("\n"),
  );
  assert.deepEqual(update, { state: "done", note: "fixed 3 failing tests" });
});

test("extract: malformed markers (bad state, missing state) are dropped silently", () => {
  const { visible, update } = extractAutoStatusMarkers(
    'a <coven:auto-status state="cooking" /> b <coven:auto-status note="no state" /> c',
  );
  assert.equal(update, null);
  assert.ok(!visible.includes("<coven:auto-status"));
});

test("extract: a partial trailing marker stays hidden until it completes", () => {
  const { visible, update } = extractAutoStatusMarkers('Some text <coven:auto-status state="wor');
  assert.equal(update, null);
  assert.equal(visible, "Some text ");
});

test("extract: fenced markers stay literal example text", () => {
  const text = ['```', '<coven:auto-status state="done" />', '```'].join("\n");
  const { visible, update } = extractAutoStatusMarkers(text);
  assert.equal(update, null);
  assert.ok(visible.includes("<coven:auto-status"));
});

test("extract: text with no marker at all returns unchanged, no update", () => {
  const { visible, update } = extractAutoStatusMarkers("just plain text");
  assert.equal(visible, "just plain text");
  assert.equal(update, null);
});
