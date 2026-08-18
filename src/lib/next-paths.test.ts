// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildNextPathsDirective,
  extractNextPaths,
  DEFAULT_NEXT_PATHS_COUNT,
  type NextPath,
} from "./next-paths.ts";

// directive: default asks for exactly 4 when sensible, prefers adaptive reply-heavy output, empty when 0
assert.equal(DEFAULT_NEXT_PATHS_COUNT, 4);
assert.match(buildNextPathsDirective(), /append 4 short typed/);
assert.match(buildNextPathsDirective(), /When sensible continuations exist, give exactly 4\./);
assert.match(buildNextPathsDirective(), /Include at least 1 reply option in every emitted block/);
assert.match(buildNextPathsDirective(), /Normally include 2 reply options/);
assert.match(buildNextPathsDirective(), /The first reply line must be \[reply:recommended\]\./);
assert.match(buildNextPathsDirective(), /\[action:save-link:recommended\]/);
assert.match(buildNextPathsDirective(), /Use \[task\] only for durable follow-up work/);
assert.match(buildNextPathsDirective(), /Use \[action:save-link\] only when your response or cited sources contain at least one valid HTTP\(S\) URL/);
assert.match(buildNextPathsDirective(), /Use \[action:open-tasks\] only for useful navigation/);
assert.match(buildNextPathsDirective(), /Fill any unused slots with \[reply\] lines/);
assert.match(buildNextPathsDirective(), /Recommendation metadata is presentation-only/);
assert.match(buildNextPathsDirective(), /when omitted, the client will not invent fallback suggestions/);
assert.match(buildNextPathsDirective(), /only in this block — do not also enumerate them in the reply body/);
assert.match(buildNextPathsDirective(), /\[task:recommended\]/);
assert.match(buildNextPathsDirective(), /\[action:open-tasks:recommended\]/);
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
for (const partial of ["[", "[action", "[action:open-tasks", "[action:save-link:recomm"]) {
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
  assert.equal(r.suggestions[0]?.recommended, false);
}
// full supported block -> stripped + parsed
{
  const t = "Here is the answer.\n\n<coven:next-paths>\n- [reply:recommended] Draft the follow-up\n- [reply] Ask for timing\n- [task:recommended] Create launch task\n- [action:save-link:recommended] Save the API guide\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Here is the answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Draft the follow-up", prompt: "Draft the follow-up", recommended: true },
    { kind: "reply", label: "Ask for timing", prompt: "Ask for timing", recommended: false },
    { kind: "task", label: "Create launch task", prompt: "Create launch task", recommended: true },
    { kind: "action", actionId: "save-link", label: "Save the API guide", prompt: "Save the API guide", recommended: true },
  ] satisfies NextPath[]);
}
// streaming (open, no close yet) -> hidden, only newline-terminated lines parsed;
// the final, still-arriving line is withheld even though it already looks complete
// (a half-typed word could still be mid-stream).
{
  const t = "Answer.\n<coven:next-paths>\n- [reply] Run the tests\n- [task] Open a";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Run the tests", prompt: "Run the tests", recommended: false },
  ] satisfies NextPath[]);
}
// Unterminated final item withheld regardless of cut position — reply, task, and
// action titles all flash-free while their line has not yet ended, and exposed the
// instant a newline (or the closing tag) completes that same line.
{
  const cuts = [
    { control: "reply", partialTitle: "Draft the follow" },
    { control: "reply", partialTitle: "D" },
    { control: "task", partialTitle: "Create a launch tas" },
    { control: "task", partialTitle: "T" },
    { control: "action:save-link", partialTitle: "Save the API gui" },
    { control: "action:open-tasks", partialTitle: "Review open ta" },
  ];
  for (const { control, partialTitle } of cuts) {
    const line = `- [${control}] ${partialTitle}`;

    // Cut mid-stream (no trailing newline yet): withheld entirely.
    const streaming = extractNextPaths(`Answer.\n<coven:next-paths>\n${line}`);
    assert.deepEqual(
      streaming.suggestions,
      [],
      `withhold unterminated ${control} title at "${partialTitle}"`,
    );

    // A newline lands (more content may still follow in the block): the now-complete
    // line is exposed immediately, without waiting for the closing tag.
    const newlineCompleted = extractNextPaths(`Answer.\n<coven:next-paths>\n${line}\n`);
    assert.equal(
      newlineCompleted.suggestions.length,
      1,
      `expose newline-completed ${control} line at "${partialTitle}"`,
    );
    assert.equal(newlineCompleted.suggestions[0]?.label, partialTitle);

    // The closing tag lands directly (no newline needed first): a closed block
    // parses its final line normally, exactly like the newline case above.
    const closeCompleted = extractNextPaths(
      `Answer.\n<coven:next-paths>\n${line}\n</coven:next-paths>`,
    );
    assert.deepEqual(newlineCompleted.suggestions, closeCompleted.suggestions);
  }
}
// A control prefix cut before its closing bracket stays withheld through a newline
// too — the bracket is still ambiguous even once that particular line is "complete",
// because the block itself has not closed and more could still be typed.
{
  const t = "Answer.\n<coven:next-paths>\n- [action:open-task Review tasks\n";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, []);
}
// supported non-recommended forms stay explicit and safe
{
  const t = "Answer.\n<coven:next-paths>\n- [reply] Draft the message\n- [task] Capture the decision\n- [action:open-tasks] Review open tasks for this project\n- [action:save-link] Save the incident doc\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Draft the message", prompt: "Draft the message", recommended: false },
    { kind: "task", label: "Capture the decision", prompt: "Capture the decision", recommended: false },
    { kind: "action", actionId: "open-tasks", label: "Review open tasks for this project", prompt: "Review open tasks for this project", recommended: false },
    { kind: "action", actionId: "save-link", label: "Save the incident doc", prompt: "Save the incident doc", recommended: false },
  ] satisfies NextPath[]);
}
// recommended navigation is allowed only for allowlisted actions
{
  const t = "Answer.\n<coven:next-paths>\n- [action:open-tasks:recommended] Review open tasks\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, [
    { kind: "action", actionId: "open-tasks", label: "Review open tasks", prompt: "Review open tasks", recommended: true },
  ] satisfies NextPath[]);
}
// legacy and malformed intent prefixes stay safe editable replies
{
  const t = "Answer.\n<coven:next-paths>\n- Legacy answer\n- [action:unknown:recommended] Unsafe action\n- [unsupported] Malformed intent\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Legacy answer", prompt: "Legacy answer", recommended: false },
    { kind: "reply", label: "Unsafe action", prompt: "Unsafe action", recommended: false },
    { kind: "reply", label: "Malformed intent", prompt: "Malformed intent", recommended: false },
  ] satisfies NextPath[]);
}
// Directive template lines are never surfaced as live suggestions.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply] first next step (imperative, <= ~7 words)\n- [task] second next step\n- [reply:recommended] Draft the follow-up message\n- [reply] Ask for the missing detail\n- [task] Create a task for the follow-up\n- [action:save-link:recommended] Save the cited guide\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// The current example block stays inert even when it is echoed verbatim.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply:recommended] Draft the follow-up message\n- [reply] Ask for the missing detail\n- [task] Create a task for the follow-up\n- [action:save-link:recommended] Save the cited guide\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// Only exact template echoes are suppressed; useful longer suggestions remain available.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:save-link:recommended] Save the cited guide for this incident\n- [reply:recommended] Draft the follow-up message to Jules\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, [
    { kind: "action", actionId: "save-link", label: "Save the cited guide for this incident", prompt: "Save the cited guide for this incident", recommended: true },
    { kind: "reply", label: "Draft the follow-up message to Jules", prompt: "Draft the follow-up message to Jules", recommended: true },
  ] satisfies NextPath[]);
}
// over-eager agent -> at most 4 pills ever surface (the prompt-width product cap)
{
  const lines = ["One", "Two", "Three", "Four", "Five", "Six"].map((s) => `- [reply] ${s}`).join("\n");
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n${lines}\n</coven:next-paths>`);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "One", prompt: "One", recommended: false },
    { kind: "reply", label: "Two", prompt: "Two", recommended: false },
    { kind: "reply", label: "Three", prompt: "Three", recommended: false },
    { kind: "reply", label: "Four", prompt: "Four", recommended: false },
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
    { kind: "reply", label: "Continue the work", prompt: "Continue the work", recommended: false },
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
    { kind: "reply", label: "Continue the work", prompt: "Continue the work", recommended: false },
  ] satisfies NextPath[]);
}

console.log("next-paths.test.ts: ok");
