// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildNextPathsDirective,
  extractNextPaths,
  DEFAULT_NEXT_PATHS_COUNT,
  type NextPath,
} from "./next-paths.ts";

assert.equal(DEFAULT_NEXT_PATHS_COUNT, 4);
const directive = buildNextPathsDirective();
assert.match(directive, /append 4 short/);
assert.match(directive, /Give exactly 4\./);
assert.match(directive, /At least one reply, normally two/);
assert.match(directive, /first reply must be \[reply:recommended\]/);
assert.match(directive, /task only for durable work/i);
assert.match(directive, /Save only when response or cited sources contain a valid HTTP\(S\) URL/i);
assert.match(directive, /navigation only when useful/i);
assert.match(directive, /fill unused positions with replies/i);
assert.match(directive, /recommendation changes presentation only, grants no authority/i);
assert.match(directive, /\[reply:recommended\]/);
assert.match(directive, /\[task:recommended\]/);
assert.match(directive, /\[action:open-tasks\]/);
assert.match(directive, /\[action:save-link:recommended\]/);
assert.equal(buildNextPathsDirective(0), "");
{
  const count2 = buildNextPathsDirective(2);
  assert.match(count2, /up to 2 short/);
  assert.ok(!count2.includes("Give exactly four"), "non-default counts must not demand exactly four");
  const count2ExampleLines = count2.split("\n").filter((line) => line.startsWith("- ["));
  assert.ok(count2ExampleLines.length <= 2, `expected at most two example lines, got ${count2ExampleLines.length}`);
}

// no block -> unchanged
{
  const r = extractNextPaths("Just an answer.");
  assert.equal(r.visible, "Just an answer.");
  assert.deepEqual(r.suggestions, []);
}

// Streaming control prefixes stay withheld until the closing bracket and title arrive.
for (const partial of ["[", "[action", "[action:save-link:recomm"]) {
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${partial}`);
  assert.deepEqual(r.suggestions, [], `withhold partial control prefix: ${partial}`);
}

// Closed trailers also suppress incomplete control prefixes.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:save-link:recomm\n</coven:next-paths>");
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, []);
}

// full block -> stripped + parsed with explicit recommendation flags
{
  const t = [
    "Here is the answer.",
    "",
    "<coven:next-paths>",
    "- [reply:recommended] Compare the two approaches for this project",
    "- [reply] Show the implementation details for the change",
    "- [task:recommended] Track the migration work in the backlog",
    "- [action:save-link:recommended] Save these sources for later",
    "</coven:next-paths>",
  ].join("\n");
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Here is the answer.");
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "Compare the two approaches for this project", prompt: "Compare the two approaches for this project", recommended: true },
      { kind: "reply", label: "Show the implementation details for the change", prompt: "Show the implementation details for the change", recommended: false },
      { kind: "task", label: "Track the migration work in the backlog", prompt: "Track the migration work in the backlog", recommended: true },
      {
        kind: "action",
        actionId: "save-link",
        label: "Save these sources for later",
        prompt: "Save these sources for later",
        recommended: true,
      },
    ] satisfies NextPath[],
  );
}

// all nonrecommended supported forms
{
  const t = [
    "Answer.",
    "<coven:next-paths>",
    "- [reply] Run the tests",
    "- [task] Open a PR",
    "- [action:open-tasks] See pending work",
    "- [action:save-link] Save the reference",
    "</coven:next-paths>",
  ].join("\n");
  const r = extractNextPaths(t);
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "Run the tests", prompt: "Run the tests", recommended: false },
      { kind: "task", label: "Open a PR", prompt: "Open a PR", recommended: false },
      { kind: "action", actionId: "open-tasks", label: "See pending work", prompt: "See pending work", recommended: false },
      { kind: "action", actionId: "save-link", label: "Save the reference", prompt: "Save the reference", recommended: false },
    ] satisfies NextPath[],
  );
}

// recommended open-tasks
{
  const r = extractNextPaths([
    "Answer.",
    "<coven:next-paths>",
    "- [action:open-tasks:recommended] Review open tasks",
    "</coven:next-paths>",
  ].join("\n"));
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "action", actionId: "open-tasks", label: "Review open tasks", prompt: "Review open tasks", recommended: true },
    ] satisfies NextPath[],
  );
}

// whitespace inside controls makes even recommended paths fall back to editable replies
{
  const t = [
    "Answer.",
    "<coven:next-paths>",
    "- [ reply:recommended]   Rewrite the reply path   ",
    "- [task:recommended ]   Route this into a task   ",
    "- [ action:open-tasks:recommended ]   Open the task list   ",
    "</coven:next-paths>",
  ].join("\n");
  const r = extractNextPaths(t);
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "Rewrite the reply path", prompt: "Rewrite the reply path", recommended: false },
      { kind: "reply", label: "Route this into a task", prompt: "Route this into a task", recommended: false },
      { kind: "reply", label: "Open the task list", prompt: "Open the task list", recommended: false },
    ] satisfies NextPath[],
  );
}

// unknown recommended action and legacy text fallback to recommended:false replies
{
  const t = [
    "Answer.",
    "<coven:next-paths>",
    "- [action:delete-everything:recommended] Unsafe action",
    "- Legacy answer",
    "</coven:next-paths>",
  ].join("\n");
  const r = extractNextPaths(t);
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "Unsafe action", prompt: "Unsafe action", recommended: false },
      { kind: "reply", label: "Legacy answer", prompt: "Legacy answer", recommended: false },
    ] satisfies NextPath[],
  );
}

// six lines truncate to four
{
  const lines = [
    "- [reply:recommended] One",
    "- [reply] Two",
    "- [task] Three",
    "- [action:open-tasks] Four",
    "- [action:save-link] Five",
    "- [reply] Six",
  ].join("\n");
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n${lines}\n</coven:next-paths>`);
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "One", prompt: "One", recommended: true },
      { kind: "reply", label: "Two", prompt: "Two", recommended: false },
      { kind: "task", label: "Three", prompt: "Three", recommended: false },
      { kind: "action", actionId: "open-tasks", label: "Four", prompt: "Four", recommended: false },
    ] satisfies NextPath[],
  );
}

// exact example block suppressed and longer labels retained
{
  const exact = [
    "Answer.",
    "<coven:next-paths>",
    "- [reply:recommended] Compare the two approaches",
    "- [reply] Show the implementation details",
    "- [task:recommended] Track the migration work",
    "- [action:save-link:recommended] Save these sources",
    "</coven:next-paths>",
  ].join("\n");
  assert.deepEqual(extractNextPaths(exact).suggestions, []);

  const longer = [
    "Answer.",
    "<coven:next-paths>",
    "- [reply:recommended] Compare the two approaches for this conversation",
    "- [reply] Show the implementation details in the current branch",
    "</coven:next-paths>",
  ].join("\n");
  assert.deepEqual(
    extractNextPaths(longer).suggestions,
    [
      {
        kind: "reply",
        label: "Compare the two approaches for this conversation",
        prompt: "Compare the two approaches for this conversation",
        recommended: true,
      },
      {
        kind: "reply",
        label: "Show the implementation details in the current branch",
        prompt: "Show the implementation details in the current branch",
        recommended: false,
      },
    ] satisfies NextPath[],
  );

  const legacy = [
    "Answer.",
    "<coven:next-paths>",
    "- [reply] first next step (imperative, <= ~7 words)",
    "- [task] second next step",
    "- [reply] Draft the follow-up message",
    "- [action:open-tasks] Review open tasks",
    "</coven:next-paths>",
  ].join("\n");
  assert.deepEqual(extractNextPaths(legacy).suggestions, []);
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
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "Continue the work", prompt: "Continue the work", recommended: false },
    ] satisfies NextPath[],
  );
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
  assert.deepEqual(
    r.suggestions,
    [
      { kind: "reply", label: "Continue the work", prompt: "Continue the work", recommended: false },
    ] satisfies NextPath[],
  );
}

console.log("next-paths.test.ts: ok");
