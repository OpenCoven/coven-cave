// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildNextPathsDirective,
  contextualizeNextPaths,
  extractNextPaths,
  DEFAULT_NEXT_PATHS_COUNT,
  type NextPath,
} from "./next-paths.ts";

// directive: default asks for exactly 3, respects count, empty when 0
assert.equal(DEFAULT_NEXT_PATHS_COUNT, 3);
assert.match(buildNextPathsDirective(), /append 3 short/);
assert.doesNotMatch(buildNextPathsDirective(), /never exactly 3/);
assert.match(buildNextPathsDirective(), /only in this block — do not also enumerate them in the reply body/);
assert.match(buildNextPathsDirective(), /\[reply\]/);
assert.match(buildNextPathsDirective(), /\[task\]/);
assert.match(buildNextPathsDirective(), /\[action:open-tasks\]/);
assert.match(buildNextPathsDirective(), /rationale="…"/, "the directive requests bounded why-this metadata");
assert.match(buildNextPathsDirective(), /evidence="message:message-id"/, "the directive requests typed evidence references");
assert.doesNotMatch(buildNextPathsDirective(), /\[action:open-changes\]/);
assert.match(buildNextPathsDirective(3), /<coven:next-paths>/);
assert.match(buildNextPathsDirective(2), /up to 2 short/);
assert.equal(buildNextPathsDirective(0), "");

// no block -> unchanged
{
  const r = extractNextPaths("Just an answer.");
  assert.equal(r.visible, "Just an answer.");
  assert.deepEqual(r.suggestions, []);
}
// Streaming control prefixes stay withheld until the closing bracket and title arrive.
for (const partial of ["[", "[action", "[action:open-tasks"]) {
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${partial}`);
  assert.deepEqual(r.suggestions, [], `withhold partial control prefix: ${partial}`);
}
// Closed trailers also suppress bare malformed control prefixes.
for (const malformed of ["[", "[action"]) {
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${malformed}\n</coven:next-paths>`);
  assert.deepEqual(r.suggestions, [], `suppress closed malformed prefix: ${malformed}`);
}
// Unterminated control syntax cannot leak into a reply or invoke an action.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:open-tasks Review tasks\n</coven:next-paths>");
  assert.equal(r.suggestions[0]?.kind, "reply");
  assert.equal(r.suggestions[0]?.label, "Review tasks");
  assert.equal(r.suggestions[0]?.prompt, "Review tasks");
}
// full block -> stripped + parsed
{
  const t = "Here is the answer.\n\n<coven:next-paths>\n- [reply] Run the tests\n- [task] Open a PR\n- [action:open-tasks] See pending work\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Here is the answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Run the tests", prompt: "Run the tests" },
    { kind: "task", label: "Open a PR", prompt: "Open a PR" },
    { kind: "action", actionId: "open-tasks", label: "See pending work", prompt: "See pending work" },
  ] satisfies NextPath[]);
}
// streaming (open, no close yet) -> hidden, partial parsed
{
  const t = "Answer.\n<coven:next-paths>\n- [reply] Run the tests\n- [task] Open a";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Run the tests", prompt: "Run the tests" },
    { kind: "task", label: "Open a", prompt: "Open a" },
  ] satisfies NextPath[]);
}
// Tagged paths carry only bounded rationale + allowlisted evidence metadata.
{
  const r = extractNextPaths(
    'Answer.\n<coven:next-paths>\n- [reply rationale="Keeps the implementation moving" evidence="message:turn-1|task:task-1"] Run the focused tests\n</coven:next-paths>',
  );
  assert.deepEqual(r.suggestions, [
    {
      kind: "reply",
      label: "Run the focused tests",
      prompt: "Run the focused tests",
      metadata: {
        rationale: "Keeps the implementation moving",
        evidenceRefs: [
          { id: "turn-1", kind: "message", label: "Recent chat message" },
          { id: "task-1", kind: "task", label: "Linked task" },
        ],
      },
    },
  ] satisfies NextPath[]);
}
// Malformed metadata is rejected rather than becoming a misleading reply.
{
  const r = extractNextPaths(
    'Answer.\n<coven:next-paths>\n- [reply rationale="too long" evidence="unknown:item"] Run the focused tests\n</coven:next-paths>',
  );
  assert.deepEqual(r.suggestions, [], "unknown evidence kinds do not survive extraction");
}
// legacy and malformed intent prefixes stay safe editable replies
{
  const t = "Answer.\n<coven:next-paths>\n- Legacy answer\n- [action:delete-everything] Unsafe action\n- [unsupported] Malformed intent\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Legacy answer", prompt: "Legacy answer" },
    { kind: "reply", label: "Unsafe action", prompt: "Unsafe action" },
    { kind: "reply", label: "Malformed intent", prompt: "Malformed intent" },
  ] satisfies NextPath[]);
}
// Directive template lines are never surfaced as live suggestions.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply] first next step (imperative, <= ~7 words)\n- [task] second next step\n- [reply] Draft the follow-up message\n- [reply] Draft the follow-up message (imperative, <= ~7 words)\n- [task] Create a task for the follow-up\n- [action:open-tasks] Review open tasks\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// The former template block stays inert even when it is echoed verbatim.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply] first next step (imperative, <= ~7 words)\n- [task] second next step\n- [reply] Draft the follow-up message\n- [task] Create a task for the follow-up\n- [action:open-tasks] Review open tasks\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// Only exact template echoes are suppressed; useful longer suggestions remain available.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:open-tasks] Review open tasks for this project\n- [reply] Draft the follow-up message to Jules\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, [
    { kind: "action", actionId: "open-tasks", label: "Review open tasks for this project", prompt: "Review open tasks for this project" },
    { kind: "reply", label: "Draft the follow-up message to Jules", prompt: "Draft the follow-up message to Jules" },
  ] satisfies NextPath[]);
}
// over-eager agent -> at most 3 pills ever surface (the prompt-width product cap)
{
  const lines = ["One", "Two", "Three", "Four", "Five", "Six"].map((s) => `- [reply] ${s}`).join("\n");
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n${lines}\n</coven:next-paths>`);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "One", prompt: "One" },
    { kind: "reply", label: "Two", prompt: "Two" },
    { kind: "reply", label: "Three", prompt: "Three" },
  ] satisfies NextPath[]);
}

// A renderer-style list fence must end at its real closing delimiter; otherwise
// that closing line is mistaken for a new unclosed fence and hides the live
// protocol block that follows it.
{
  const fenced = [
    "- ```text",
    "  <coven:next-paths>",
    "  - [reply] Literal example",
    "  </coven:next-paths>",
    "  ```",
  ].join("\n");
  const r = extractNextPaths(
    `${fenced}\n<coven:next-paths>\n- [reply] Continue the work\n</coven:next-paths>`,
  );
  assert.equal(r.visible, fenced);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Continue the work", prompt: "Continue the work" },
  ] satisfies NextPath[]);
}

{
  const fenced = [
    "> ```text",
    "> <coven:next-paths>",
    "> - [reply] Literal example",
    "> </coven:next-paths>",
    "> ````",
  ].join("\n");
  const r = extractNextPaths(
    `${fenced}\n<coven:next-paths>\n- [reply] Continue the work\n</coven:next-paths>`,
  );
  assert.equal(r.visible, fenced);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Continue the work", prompt: "Continue the work" },
  ] satisfies NextPath[]);
}

// Chat can hydrate a parsed path with its bounded current message, linked task,
// and settled tool outcome without changing the action kind or prompt.
{
  const [path] = contextualizeNextPaths(
    [{ kind: "reply", label: "Run the focused tests", prompt: "Run the focused tests" }],
    {
      messageId: "turn-1",
      taskId: "task-1",
      toolOutcomeIds: ["tool-1", "tool-2"],
    },
  );
  assert.deepEqual(path, {
    kind: "reply",
    label: "Run the focused tests",
    prompt: "Run the focused tests",
    metadata: {
      rationale: "Suggested from the latest assistant response.",
      evidenceRefs: [
        { id: "turn-1", kind: "message", label: "Latest assistant response" },
        { id: "task-1", kind: "task", label: "Linked task" },
        { id: "tool-1", kind: "artifact", label: "Recent tool outcome" },
      ],
    },
  } satisfies NextPath);
}

// Model-authored evidence is only a claim. Chat keeps the supplied references
// first and drops unresolvable IDs, including when the valid IDs begin with a
// digit as normal UUIDs do.
{
  const messageId = "0f4d5c55-6f15-4e7c-a1f4-3462fb56e5c4";
  const toolId = "1e3c2f11-17de-4e01-aab2-35b9f4e2b555";
  const [path] = contextualizeNextPaths(
    [
      {
        kind: "reply",
        label: "Run the focused tests",
        prompt: "Run the focused tests",
        metadata: {
          rationale: "Model-supplied context",
          evidenceRefs: [
            { id: "message-not-in-context", kind: "message", label: "Recent chat message" },
            { id: "artifact-not-in-context", kind: "artifact", label: "Recent tool outcome" },
          ],
        },
      },
    ],
    { messageId, taskId: "task-1", toolOutcomeIds: [toolId] },
  );
  assert.deepEqual(
    path?.metadata?.evidenceRefs,
    [
      { id: messageId, kind: "message", label: "Latest assistant response" },
      { id: "task-1", kind: "task", label: "Linked task" },
      { id: toolId, kind: "artifact", label: "Recent tool outcome" },
    ],
    "only bounded supplied refs render, in trusted context order",
  );
}

console.log("next-paths.test.ts: ok");
