import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODE_COMPOSER_MAX_SUGGESTIONS,
  CODE_COMPOSER_STATUS,
  buildCodeFollowUp,
  codeComposerOutcome,
  codeComposerReplyTail,
  codeComposerSuggestions,
} from "./code-composer-context.ts";

test("suggestions are gated on desk state, most specific first, never more than four", () => {
  const bare = codeComposerSuggestions({ fileName: null, hasChanges: false, hasPr: false });
  assert.deepEqual(bare.map((s) => s.id), ["run-checks"]);

  const full = codeComposerSuggestions({ fileName: "AGENTS.md", hasChanges: true, hasPr: true });
  assert.equal(full.length, CODE_COMPOSER_MAX_SUGGESTIONS);
  assert.deepEqual(full.map((s) => s.id), ["review-changes", "explain-file", "test-file", "summarize-pr"]);
  assert.match(full[1].prompt, /AGENTS\.md/);

  const fileOnly = codeComposerSuggestions({ fileName: "flux.ts", hasChanges: false, hasPr: false });
  assert.deepEqual(fileOnly.map((s) => s.id), ["explain-file", "test-file", "run-checks"]);
});

test("the follow-up leads with the file context only when the chip is on", () => {
  const base = { prompt: "  Tighten the retry loop.  ", contextPath: "src/flux.ts", rangeLabel: null, includeContext: true };
  assert.equal(buildCodeFollowUp(base), "Regarding `src/flux.ts`:\n\nTighten the retry loop.");
  assert.equal(
    buildCodeFollowUp({ ...base, rangeLabel: "lines 12–30" }),
    "Regarding `src/flux.ts` (lines 12–30):\n\nTighten the retry loop.",
  );
  assert.equal(buildCodeFollowUp({ ...base, includeContext: false }), "Tighten the retry loop.");
  assert.equal(buildCodeFollowUp({ ...base, contextPath: null }), "Tighten the retry loop.");
  assert.equal(buildCodeFollowUp({ ...base, prompt: "   " }), "", "an empty prompt sends nothing, context or not");
});

test("status words keep one verb through the lifecycle and the tail is a peek", () => {
  assert.deepEqual(CODE_COMPOSER_STATUS, {
    idle: "",
    streaming: "Replying…",
    done: "Replied",
    error: "Couldn't reply",
    stopped: "Stopped",
  });
  assert.equal(codeComposerReplyTail("a\nb\nc\nd\ne\n"), "c\nd\ne");
  assert.equal(codeComposerReplyTail("one"), "one");
});

test("an outcome names what happened: stopped, failed partway, failed outright, or replied (#5729)", () => {
  assert.deepEqual(codeComposerOutcome({ text: "", error: "cancelled", stoppedByReader: true }), {
    phase: "stopped", message: null, restorePrompt: true,
  }, "stopped before any text: say so, and give the ask back");
  assert.deepEqual(codeComposerOutcome({ text: "Half an answer", error: "cancelled", stoppedByReader: true }), {
    phase: "stopped", message: null, restorePrompt: false,
  }, "stopped partway: keep the partial reply, not an error");
  assert.deepEqual(codeComposerOutcome({ text: "Partial.", error: "model overloaded", stoppedByReader: false }), {
    phase: "error", message: "model overloaded", restorePrompt: false,
  }, "text then an error is a failure, never \"Replied\"");
  assert.deepEqual(codeComposerOutcome({ text: "", error: "chat bridge 502", stoppedByReader: false }), {
    phase: "error", message: "chat bridge 502", restorePrompt: true,
  });
  assert.deepEqual(codeComposerOutcome({ text: "All done.", error: null, stoppedByReader: false }), {
    phase: "done", message: null, restorePrompt: false,
  });
  assert.equal(codeComposerOutcome({ text: "   ", error: "x", stoppedByReader: false }).restorePrompt, true, "whitespace is no answer");
});
