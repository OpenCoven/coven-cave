import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODE_COMPOSER_MAX_SUGGESTIONS,
  CODE_COMPOSER_STATUS,
  buildCodeFollowUp,
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
  });
  assert.equal(codeComposerReplyTail("a\nb\nc\nd\ne\n"), "c\nd\ne");
  assert.equal(codeComposerReplyTail("one"), "one");
});
