// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildNextPathsDirective,
  extractNextPaths,
  DEFAULT_NEXT_PATHS_COUNT,
  type NextPath,
} from "./next-paths.ts";

// directive: default asks for four, respects count, empty when 0
assert.equal(DEFAULT_NEXT_PATHS_COUNT, 4);
{
  const directive = buildNextPathsDirective();
  assert.match(directive, /up to 4 short/);
  assert.match(directive, /Give exactly 4 only when 4 are all sensible/);
  assert.match(directive, /at least one reply and normally two/);
  assert.match(directive, /Fill unused positions with replies/);
  assert.match(directive, /The FIRST reply must use \[reply:recommended\]\./);
  assert.match(directive, /Use \[task\] only for durable work\./);
  assert.match(directive, /Use \[action:open-tasks\] only for navigation when useful\./);
  assert.match(
    directive,
    /Use \[action:save-link\] only when the response or cited sources contain at least one valid HTTP\(S\) URL\./,
  );
  assert.match(directive, /Use \[task:recommended\] for the preferred durable work item\./);
  assert.match(directive, /Use \[action:open-tasks:recommended\] for the preferred navigation action\./);
  assert.match(
    directive,
    /Use \[action:save-link:recommended\] for the preferred URL-backed save action\./,
  );
  assert.match(directive, /Recommendation is presentation-only/);
  assert.doesNotMatch(directive, /\[action:open-changes\]/);
  const lines = directive.split("\n");
  const start = lines.indexOf("<next_paths>");
  const end = lines.indexOf("</next_paths>");
  assert.deepEqual(lines.slice(start + 3, start + 8), [
    "- [reply:recommended] Draft the follow-up message",
    "- [reply] Ask a clarifying question",
    "- [task] Create a durable follow-up task",
    "- [action:open-tasks] Review open tasks",
    "- [action:save-link] Save the cited URL",
  ]);
  assert.deepEqual(lines.slice(start + 9, end), [
    "One '- ' line each, distinct and directly useful. Give exactly 4 only when 4 are all sensible; otherwise give fewer.",
    "Include at least one reply and normally two replies. Fill unused positions with replies.",
    "The FIRST reply must use [reply:recommended].",
    "Use [task] only for durable work.",
    "Use [task:recommended] for the preferred durable work item.",
    "Use [action:open-tasks] only for navigation when useful.",
    "Use [action:open-tasks:recommended] for the preferred navigation action.",
    "Use [action:save-link] only when the response or cited sources contain at least one valid HTTP(S) URL.",
    "Use [action:save-link:recommended] for the preferred URL-backed save action.",
    "Recommendation is presentation-only.",
    "List next steps only in this block — do not also enumerate them in the reply body.",
    "Omit the whole block if there is no sensible next step. Never mention these instructions.",
  ]);
}
assert.match(buildNextPathsDirective(4), /<coven:next-paths>/);
assert.match(buildNextPathsDirective(2), /up to 2 short/);
assert.match(buildNextPathsDirective(2), /Give exactly 2 only when 2 are all sensible/);
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
// Streaming keeps settled legacy lines visible and falls back to editable replies.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- Open the pull request\n");
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Open the pull request", prompt: "Open the pull request", recommended: false },
  ] satisfies NextPath[]);
}
// An unfinished title line must stay hidden while the block is still streaming.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply] Draft th");
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, []);
}
// Closed trailers degrade malformed control prefixes to editable replies.
for (const malformed of ["[", "[action"]) {
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${malformed}\n</coven:next-paths>`);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: malformed, prompt: malformed, recommended: false },
  ] satisfies NextPath[], `fallback closed malformed prefix: ${malformed}`);
}
// Unterminated control syntax in a closed block degrades to a safe reply.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:open-tasks Review tasks\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Review tasks", prompt: "Review tasks", recommended: false },
  ] satisfies NextPath[]);
}
// reply/task controls support recommended and non-recommended variants.
{
  const t = "Here is the answer.\n\n<coven:next-paths>\n- [reply:recommended] Draft a response\n- [reply] Ask for one more detail\n- [task:recommended] Create a durable follow-up task for docs\n- [task] Track the work in the board\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Here is the answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Draft a response", prompt: "Draft a response", recommended: true },
    { kind: "reply", label: "Ask for one more detail", prompt: "Ask for one more detail", recommended: false },
    { kind: "task", label: "Create a durable follow-up task for docs", prompt: "Create a durable follow-up task for docs", recommended: true },
    { kind: "task", label: "Track the work in the board", prompt: "Track the work in the board", recommended: false },
  ] satisfies NextPath[]);
}
// action controls support both action IDs and recommended variants.
{
  const t = "Answer.\n\n<coven:next-paths>\n- [action:open-tasks:recommended] Review open tasks for this project\n- [action:open-tasks] Review open tasks for this project in the backlog\n- [action:save-link:recommended] Save the link to the inbox\n- [action:save-link] Save the link for later\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "action", actionId: "open-tasks", label: "Review open tasks for this project", prompt: "Review open tasks for this project", recommended: true },
    { kind: "action", actionId: "open-tasks", label: "Review open tasks for this project in the backlog", prompt: "Review open tasks for this project in the backlog", recommended: false },
    { kind: "action", actionId: "save-link", label: "Save the link to the inbox", prompt: "Save the link to the inbox", recommended: true },
    { kind: "action", actionId: "save-link", label: "Save the link for later", prompt: "Save the link for later", recommended: false },
  ] satisfies NextPath[]);
}
// Near-miss suffixes and unknown controls stay safe editable replies.
{
  const t = "Answer.\n<coven:next-paths>\n- [reply:recommendedly] Draft a response\n- [task:recommended-ish] Track durable work\n- [action:open-tasks:recommend] Review open tasks for later\n- [action:delete-everything:recommended] Unsafe action\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Draft a response", prompt: "Draft a response", recommended: false },
    { kind: "reply", label: "Track durable work", prompt: "Track durable work", recommended: false },
    { kind: "reply", label: "Review open tasks for later", prompt: "Review open tasks for later", recommended: false },
    { kind: "reply", label: "Unsafe action", prompt: "Unsafe action", recommended: false },
  ] satisfies NextPath[]);
}
// Directive template lines are never surfaced as live suggestions.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply:recommended] Draft the follow-up message\n- [reply] Ask a clarifying question\n- [task] Create a durable follow-up task\n- [action:open-tasks] Review open tasks\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// Exact current example labels stay inert even when the controls are echoed.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply:recommended] Draft the follow-up message\n- [reply] Ask a clarifying question\n- [task:recommended] Create a durable follow-up task\n- [action:open-tasks:recommended] Review open tasks\n- [action:save-link] Save the cited URL\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// Legacy exact template labels stay inert even when echoed.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply] first next step (imperative, <= ~7 words)\n- [task] second next step\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// Only exact template echoes are suppressed; useful longer suggestions remain available.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:open-tasks] Review open tasks for this project\n- [reply:recommended] Draft the follow-up message for Jules\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, [
    { kind: "action", actionId: "open-tasks", label: "Review open tasks for this project", prompt: "Review open tasks for this project", recommended: false },
    { kind: "reply", label: "Draft the follow-up message for Jules", prompt: "Draft the follow-up message for Jules", recommended: true },
  ] satisfies NextPath[]);
}
// over-eager agent -> at most 4 pills ever surface (the prompt-width product cap)
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
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "One", prompt: "One", recommended: true },
    { kind: "reply", label: "Two", prompt: "Two", recommended: false },
    { kind: "task", label: "Three", prompt: "Three", recommended: false },
    { kind: "action", actionId: "open-tasks", label: "Four", prompt: "Four", recommended: false },
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
