// @ts-nocheck
// Canvas add tile (cave-fema): the pure composer state machine behind the
// in-grid "New sketch" tile. Phases: collapsed -> composing -> generating ->
// result | error. Retention rules matter: a collapse or failure must never
// eat the user's prompt or pasted code; only a successful save resets.
import assert from "node:assert/strict";
import {
  INITIAL_ADD_TILE_STATE,
  addTileReducer,
  buildAddArtifact,
  derivePastedTitle,
  detectPastedKind,
} from "./canvas-add.ts";
import { STARTER_ARTIFACT_HTML } from "./canvas-artifacts.ts";

const s0 = INITIAL_ADD_TILE_STATE;

// ── expand / collapse ────────────────────────────────────────────────────────
{
  const open = addTileReducer(s0, { type: "expand" });
  assert.equal(open.phase, "composing", "expand opens the composer");
  assert.equal(open.mode, "describe", "describe is the default mode");

  const closed = addTileReducer(
    { ...open, prompt: "a pricing page" },
    { type: "collapse" },
  );
  assert.equal(closed.phase, "collapsed", "collapse closes the tile");
  assert.equal(closed.prompt, "a pricing page", "collapse retains the prompt");
  assert.equal(closed.result, null, "collapse discards an unsaved result");
  assert.equal(closed.error, null, "collapse clears errors");
}

// ── mode switching ───────────────────────────────────────────────────────────
{
  const open = addTileReducer(s0, { type: "expand" });
  const blank = addTileReducer(open, { type: "set-mode", mode: "blank" });
  assert.equal(blank.mode, "blank");
  assert.equal(blank.pastedCode, STARTER_ARTIFACT_HTML, "blank seeds the starter template");

  // Switching to blank must never clobber code the user already pasted.
  const pasted = addTileReducer(
    { ...open, mode: "paste", pastedCode: "<h1>mine</h1>" },
    { type: "set-mode", mode: "blank" },
  );
  assert.equal(pasted.pastedCode, "<h1>mine</h1>", "blank never overwrites non-empty code");

  const back = addTileReducer(blank, { type: "set-mode", mode: "describe" });
  assert.equal(back.pastedCode, STARTER_ARTIFACT_HTML, "mode switches retain editor contents");
}

// ── generate lifecycle ───────────────────────────────────────────────────────
{
  const open = addTileReducer(s0, { type: "expand" });
  assert.equal(
    addTileReducer(open, { type: "generate" }).phase,
    "composing",
    "generate is a no-op with an empty prompt",
  );

  const composed = { ...open, prompt: "a kanban board" };
  const generating = addTileReducer(composed, { type: "generate" });
  assert.equal(generating.phase, "generating");

  const done = addTileReducer(generating, {
    type: "generated",
    code: "<!doctype html><html><body>x</body></html>",
    kind: "html",
  });
  assert.equal(done.phase, "result");
  assert.equal(done.result.kind, "html");

  const failed = addTileReducer(generating, {
    type: "generation-failed",
    message: "the familiar reported an error",
  });
  assert.equal(failed.phase, "error");
  assert.equal(failed.error, "the familiar reported an error");
  assert.equal(failed.prompt, "a kanban board", "failure retains the prompt");

  const retried = addTileReducer(failed, { type: "retry" });
  assert.equal(retried.phase, "generating", "retry re-enters generating");
  assert.equal(retried.error, null);
}

// ── refine keeps the prior result until replaced ─────────────────────────────
{
  const result = {
    ...s0,
    phase: "result",
    prompt: "a form",
    result: { code: "<p>v1</p>", kind: "html" },
  };
  const refining = addTileReducer(result, { type: "refine" });
  assert.equal(refining.phase, "generating");
  assert.deepEqual(refining.result, result.result, "refine retains the prior sketch mid-flight");

  const refineFailed = addTileReducer(refining, {
    type: "generation-failed",
    message: "cancelled",
  });
  assert.deepEqual(refineFailed.result, result.result, "a failed refine keeps the prior sketch");
}

// ── discard and saved ────────────────────────────────────────────────────────
{
  const result = {
    ...s0,
    phase: "result",
    prompt: "a form",
    result: { code: "<p>v1</p>", kind: "html" },
  };
  const discarded = addTileReducer(result, { type: "discard-result" });
  assert.equal(discarded.phase, "composing");
  assert.equal(discarded.result, null);
  assert.equal(discarded.prompt, "a form", "discard keeps the prompt for another go");

  const saved = addTileReducer(result, { type: "saved" });
  assert.deepEqual(saved, INITIAL_ADD_TILE_STATE, "save resets the whole composer");
}

// ── field edits ──────────────────────────────────────────────────────────────
{
  const open = addTileReducer(s0, { type: "expand" });
  assert.equal(addTileReducer(open, { type: "set-prompt", prompt: "x" }).prompt, "x");
  const code = addTileReducer(open, { type: "set-pasted-code", code: "<div/>" });
  assert.equal(code.pastedCode, "<div/>");
  const titled = addTileReducer(open, { type: "set-pasted-title", title: "My sketch" });
  assert.equal(titled.pastedTitle, "My sketch");
}

// ── derivePastedTitle ────────────────────────────────────────────────────────
assert.equal(
  derivePastedTitle("<!doctype html><html><head><title>Neat Page</title></head></html>"),
  "Neat Page",
  "prefers the document title",
);
assert.equal(
  derivePastedTitle("<body><h1>Big <em>Header</em></h1></body>"),
  "Big Header",
  "falls back to h1 text, tags stripped",
);
assert.equal(derivePastedTitle("<p>no headings</p>"), "Pasted sketch", "defaults when untitled");
assert.equal(
  derivePastedTitle(`<h1>${"long ".repeat(40)}</h1>`).length <= 60,
  true,
  "titles are clamped like every other artifact title",
);

// ── detectPastedKind ─────────────────────────────────────────────────────────
assert.equal(detectPastedKind("<!doctype html><html></html>"), "html");
assert.equal(detectPastedKind("export default function App() { return <p/>; }"), "react");

// ── buildAddArtifact ─────────────────────────────────────────────────────────
{
  const art = buildAddArtifact({
    id: "art-1",
    now: "2026-07-17T00:00:00.000Z",
    mode: "describe",
    prompt: "a pricing page with three tiers",
    pastedTitle: "",
    code: "<!doctype html><html></html>",
    kind: "html",
  });
  assert.equal(art.title, "a pricing page with three tiers", "describe titles from the prompt");
  assert.equal(art.prompt, "a pricing page with three tiers");
  assert.equal(art.createdAt, art.updatedAt);

  const pasted = buildAddArtifact({
    id: "art-2",
    now: "2026-07-17T00:00:00.000Z",
    mode: "paste",
    prompt: "",
    pastedTitle: "",
    code: "<html><head><title>Hand-made</title></head></html>",
    kind: "html",
  });
  assert.equal(pasted.title, "Hand-made", "paste derives its title from the code");
  assert.equal(pasted.prompt, "", "pasted sketches carry no generation prompt");

  const named = buildAddArtifact({
    id: "art-3",
    now: "2026-07-17T00:00:00.000Z",
    mode: "paste",
    prompt: "",
    pastedTitle: "Explicit name",
    code: "<p>x</p>",
    kind: "html",
  });
  assert.equal(named.title, "Explicit name", "an explicit title wins");
}

console.log("canvas-add.test.ts: ok");
