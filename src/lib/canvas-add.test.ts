// @ts-nocheck
import assert from "node:assert/strict";
import {
  INITIAL_ADD_TILE_STATE,
  addTileReducer,
  buildAddArtifact,
  buildArtifactRevision,
  derivePastedTitle,
  detectPastedKind,
  focusTargetForState,
  generationStatusText,
} from "./canvas-add.ts";
import {
  MAX_ARTIFACT_CODE_CHARS,
  STARTER_ARTIFACT_HTML,
  STARTER_ARTIFACT_REACT,
} from "./canvas-artifacts.ts";

const reduce = (state, ...events) => events.reduce(addTileReducer, state);
const identity = { id: "art-stable", createdAt: "2026-07-18T00:00:00.000Z" };

// Describe-first expand and prompt retention.
const open = addTileReducer(INITIAL_ADD_TILE_STATE, { type: "expand" });
assert.equal(open.phase, "composing");
assert.equal(open.mode, "describe");
const prompted = addTileReducer(open, { type: "set-prompt", prompt: "a pricing page" });
assert.equal(addTileReducer(prompted, { type: "collapse" }).prompt, "a pricing page");

// Advanced paths are explicit and use the requested implementation starter.
const html = addTileReducer(open, { type: "set-mode", mode: "blank-html" });
assert.equal(html.pastedCode, STARTER_ARTIFACT_HTML);
const react = addTileReducer(open, { type: "set-mode", mode: "blank-react" });
assert.equal(react.pastedCode, STARTER_ARTIFACT_REACT);
assert.equal(detectPastedKind(react.pastedCode), "react");
assert.equal(addTileReducer(open, { type: "set-mode", mode: "paste" }).pastedCode, "");

// Focus and live-region behavior are derived from state, not timing or stream
// chunk count, so keyboard/SR outcomes remain stable across rerenders.
assert.equal(focusTargetForState(open, "collapsed"), "prompt");
assert.equal(focusTargetForState(react, "collapsed"), "editor");
assert.equal(focusTargetForState({ ...open, phase: "generating" }, "composing"), "cancel");
assert.equal(focusTargetForState({ ...open, phase: "repairing" }, "generating"), "cancel");
assert.equal(focusTargetForState({ ...open, phase: "result" }, "generating"), "refine");
assert.equal(focusTargetForState({ ...open, phase: "error" }, "repairing"), "retry");
assert.equal(generationStatusText("generating", "Nova"), "Nova is creating your preview…");
assert.equal(generationStatusText("repairing", "Nova"), "Still preparing your preview…");

// One identity survives initial generation, format repair, save, and refines.
const creating = reduce(
  prompted,
  { type: "begin-generation", runId: "run-1", identity },
  { type: "begin-repair", runId: "run-1" },
);
assert.equal(creating.phase, "repairing");
assert.deepEqual(creating.identity, identity);
const generated = addTileReducer(creating, {
  type: "generated",
  runId: "run-1",
  code: "<html>v1</html>",
  kind: "html",
  sessionId: "canvas-session",
  revision: 1,
});
assert.equal(generated.phase, "result");
assert.equal(generated.saveState, "saving");
const saved = addTileReducer(generated, {
  type: "save-succeeded",
  revision: 1,
  savedUpdatedAt: "2026-07-20T12:01:00.000Z",
});
assert.equal(saved.saveState, "saved");
assert.equal(saved.result.sessionId, "canvas-session");
assert.equal(saved.persistedUpdatedAt, "2026-07-20T12:01:00.000Z");
const deduped = addTileReducer(generated, {
  type: "save-succeeded",
  revision: 1,
  savedId: "art-incumbent",
  savedCreatedAt: "incumbent-created-at",
});
assert.equal(deduped.identity.id, "art-incumbent", "content-deduped saves adopt the settled id");
assert.equal(deduped.identity.createdAt, "incumbent-created-at", "dedupe adopts the incumbent creation time");
assert.deepEqual(saved.persistedResult, saved.result);
const refining = addTileReducer(saved, { type: "begin-refine", runId: "run-2" });
assert.equal(refining.generationPurpose, "refine");
assert.deepEqual(refining.identity, identity);
assert.equal(refining.persistedUpdatedAt, saved.persistedUpdatedAt, "refine retains the guarded saved revision");
const refined = addTileReducer(refining, {
  type: "generated",
  runId: "run-2",
  code: "<html>v2</html>",
  kind: "html",
  sessionId: "canvas-session",
  revision: 2,
});
assert.equal(refined.result.code, "<html>v2</html>");
assert.equal(refined.result.sessionId, "canvas-session");
assert.equal(refined.saveState, "saving");

// Persistence failure keeps the valid preview and retry is revision-idempotent.
const notSaved = addTileReducer(refined, { type: "save-failed", revision: 2 });
assert.equal(notSaved.phase, "result");
assert.equal(notSaved.result.code, "<html>v2</html>");
assert.equal(notSaved.persistedResult.code, "<html>v1</html>");
assert.equal(notSaved.saveState, "error");
assert.equal(addTileReducer(notSaved, { type: "save-started", revision: 1 }).saveState, "error", "stale retry ignored");
assert.equal(addTileReducer(notSaved, { type: "save-started", revision: 2 }).saveState, "saving");

// Failed refine preserves the last valid preview and saved revision.
const refineFailed = addTileReducer(refining, {
  type: "generation-failed",
  runId: "run-2",
  message: "could not refine",
  kind: "generation",
});
assert.equal(refineFailed.phase, "result");
assert.deepEqual(refineFailed.result, saved.result);
assert.deepEqual(refineFailed.persistedResult, saved.persistedResult);

// Format repair is one explicit phase and late/wrong-run events are rejected.
assert.equal(
  addTileReducer({ ...creating, phase: "generating" }, { type: "begin-repair", runId: "wrong" }).phase,
  "generating",
);
const collapsed = addTileReducer(creating, { type: "collapse" });
assert.equal(collapsed.phase, "collapsed");
assert.equal(
  addTileReducer(collapsed, { type: "generated", runId: "run-1", code: "late", kind: "html", sessionId: "late", revision: 1 }).result,
  null,
  "late generation cannot resurrect a cancelled run",
);
assert.equal(
  addTileReducer(creating, { type: "generated", runId: "other", code: "late", kind: "html", sessionId: "late", revision: 1 }).result,
  null,
  "a previous run cannot overwrite the active run",
);

// Closing an unsaved preview retains it; closing a saved preview completes it.
assert.equal(addTileReducer(generated, { type: "collapse" }).result.code, "<html>v1</html>");
assert.deepEqual(addTileReducer(saved, { type: "collapse" }), INITIAL_ADD_TILE_STATE);
const savingClosed = addTileReducer(generated, { type: "collapse" });
assert.deepEqual(
  addTileReducer(savingClosed, { type: "save-succeeded", revision: 1 }),
  INITIAL_ADD_TILE_STATE,
  "a late successful autosave joins the gallery without reopening the draft",
);

// A saved draft discards only after the component's DELETE succeeds; a local
// unsaved draft can clear immediately while keeping the description editable.
const discarded = addTileReducer(notSaved, { type: "discard-local" });
assert.equal(discarded.phase, "composing");
assert.equal(discarded.result, null);
assert.equal(discarded.prompt, "a pricing page");

// Payload helpers keep identity and createdAt stable while updatedAt advances.
const v1 = buildArtifactRevision({ identity, prompt: "a dashboard", code: "one", kind: "html", updatedAt: "t1" });
const v2 = buildArtifactRevision({ identity, prompt: "a dashboard", code: "two", kind: "react", updatedAt: "t2" });
assert.equal(v1.id, v2.id);
assert.equal(v1.createdAt, v2.createdAt);
assert.equal(v2.updatedAt, "t2");
assert.equal(v2.code, "two");

assert.equal(derivePastedTitle("<title>Neat Page</title>"), "Neat Page");
assert.equal(derivePastedTitle("<h1>Big <em>Header</em></h1>"), "Big Header");
assert.equal(derivePastedTitle("<p>none</p>"), "Pasted sketch");
assert.equal(detectPastedKind("export default function App(){return <p/>}"), "react");

const clamped = buildAddArtifact({
  id: "art-code",
  now: "now",
  mode: "paste",
  prompt: "",
  pastedTitle: "Code",
  code: "x".repeat(MAX_ARTIFACT_CODE_CHARS + 10),
  kind: "html",
});
assert.equal(clamped.code.length, MAX_ARTIFACT_CODE_CHARS);

console.log("canvas-add.test.ts: ok");
