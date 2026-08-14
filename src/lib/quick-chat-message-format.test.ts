import assert from "node:assert/strict";
import test from "node:test";
import { formatQuickChatAssistantMessage } from "./quick-chat-message-format.ts";

test("streaming quick-chat text hides protocol details and keeps live skill status", () => {
  const formatted = formatQuickChatAssistantMessage(
    [
      "Checking **the branch**.",
      '<coven:skill name="verification-before-completion" stage="running" note="Running focused checks" />',
      '<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3982" title="Preview',
    ].join("\n"),
    true,
  );

  assert.equal(formatted.copyText, "Checking **the branch**.");
  assert.deepEqual(formatted.pieces, [{ kind: "text", text: "Checking **the branch**." }]);
  assert.deepEqual(formatted.skillUpdates, [
    {
      name: "verification-before-completion",
      stage: "running",
      note: "Running focused checks",
    },
  ]);
});

test("settled quick-chat text returns cards and typed next paths without control text", () => {
  const formatted = formatQuickChatAssistantMessage(
    [
      "Ready for review.",
      '<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3982" />',
      "<coven:next-paths>",
      "- [reply] Open the pull request",
      "- [task] Review the diff",
      "- [action:open-tasks] Show open tasks",
      "</coven:next-paths>",
    ].join("\n"),
    false,
  );

  assert.equal(formatted.copyText, "Ready for review.");
  assert.deepEqual(formatted.suggestions, [
    { kind: "reply", label: "Open the pull request", prompt: "Open the pull request" },
    { kind: "task", label: "Review the diff", prompt: "Review the diff" },
    {
      kind: "action",
      actionId: "open-tasks",
      label: "Show open tasks",
      prompt: "Show open tasks",
    },
  ]);
  assert.equal(formatted.pieces[1]?.kind, "card");
  assert.deepEqual(
    formatted.pieces[1]?.kind === "card" ? formatted.pieces[1].descriptor : null,
    {
      kind: "pr",
      repo: "OpenCoven/coven-cave",
      number: 3982,
      title: undefined,
    },
  );
});

test("settled quick-chat text hides an interrupted GitHub marker tail", () => {
  const formatted = formatQuickChatAssistantMessage(
    'Checks finished.\n<coven:github-action kind="comment" repo="OpenCoven/coven-cave"',
    false,
  );

  assert.equal(formatted.copyText, "Checks finished.");
  assert.deepEqual(formatted.pieces, [{ kind: "text", text: "Checks finished." }]);
});

test("quick-chat text hides an interrupted next-path marker tail", () => {
  for (const streaming of [true, false]) {
    const formatted = formatQuickChatAssistantMessage(
      "Checks finished.\n<coven:next-paths",
      streaming,
    );

    assert.equal(formatted.copyText, "Checks finished.");
    assert.deepEqual(formatted.pieces, [{ kind: "text", text: "Checks finished." }]);
    assert.deepEqual(formatted.suggestions, []);
  }
});

test("partial next-path opening and closing prefixes stay hidden", () => {
  const opening = formatQuickChatAssistantMessage(
    "Checks finished.\n<coven:",
    true,
  );
  assert.equal(opening.copyText, "Checks finished.");
  assert.deepEqual(opening.pieces, [{ kind: "text", text: "Checks finished." }]);

  const closing = formatQuickChatAssistantMessage(
    [
      "Checks finished.",
      "<coven:next-paths>",
      "- [reply] Continue",
      "</coven:next-paths",
    ].join("\n"),
    false,
  );
  assert.equal(closing.copyText, "Checks finished.");
  assert.deepEqual(closing.suggestions, [
    { kind: "reply", label: "Continue", prompt: "Continue" },
  ]);
});

test("interrupted next-path markers hide all trailing control content", () => {
  const url = "https://github.com/OpenCoven/coven-cave/pull/3982";

  const opening = formatQuickChatAssistantMessage(
    `Checks finished.\n<coven:next-paths\n${url}`,
    true,
  );
  assert.equal(opening.copyText, "Checks finished.");
  assert.deepEqual(opening.pieces, [{ kind: "text", text: "Checks finished." }]);

  const closing = formatQuickChatAssistantMessage(
    [
      "Checks finished.",
      "<coven:next-paths>",
      "- [reply] Continue",
      "</coven:next-paths",
      url,
    ].join("\n"),
    false,
  );
  assert.equal(closing.copyText, "Checks finished.");
  assert.deepEqual(closing.pieces, [{ kind: "text", text: "Checks finished." }]);
  assert.deepEqual(closing.suggestions, [
    { kind: "reply", label: "Continue", prompt: "Continue" },
  ]);
});

test("an interrupted multiline GitHub marker cannot unfurl URLs from its attributes", () => {
  const formatted = formatQuickChatAssistantMessage(
    [
      "Preparing the comment.",
      '<coven:github-action kind="comment" repo="OpenCoven/coven-cave" body="See',
      "https://github.com/OpenCoven/coven-cave/pull/3982",
    ].join("\n"),
    false,
  );

  assert.equal(formatted.copyText, "Preparing the comment.");
  assert.deepEqual(formatted.pieces, [{ kind: "text", text: "Preparing the comment." }]);
});

test("streaming and settled replies keep Markdown pieces stable around complete GitHub markers", () => {
  const text = [
    "**Before the preview.**",
    '<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3982" />',
    "_After the preview._",
  ].join("\n");

  const streaming = formatQuickChatAssistantMessage(text, true);
  const settled = formatQuickChatAssistantMessage(text, false);

  assert.deepEqual(streaming.pieces, settled.pieces);
});

test("bare GitHub URLs stay visible while streaming and unfurl after settlement", () => {
  const url = "https://github.com/OpenCoven/coven-cave/pull/3982";

  const streaming = formatQuickChatAssistantMessage(url, true);
  const settled = formatQuickChatAssistantMessage(url, false);

  assert.equal(streaming.copyText, url);
  assert.deepEqual(streaming.pieces, [{ kind: "text", text: url }]);
  assert.equal(settled.pieces.length, 1);
  assert.equal(settled.pieces[0]?.kind, "card");
});

test("fenced marker examples stay literal and next-path trailers stay hidden", () => {
  const formatted = formatQuickChatAssistantMessage(
    [
      "Example:",
      "```xml",
      '<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3982" />',
      "```",
      "<coven:next-paths>",
      "- [reply] Continue",
      "</coven:next-paths>",
    ].join("\n"),
    false,
  );

  assert.match(formatted.copyText, /<coven:github kind="pr"/);
  assert.doesNotMatch(formatted.copyText, /coven:next-paths|\[reply\] Continue/);
  assert.ok(formatted.pieces.every((piece) => piece.kind === "text"));
});

test("fenced next-path examples stay literal instead of becoming suggestions", () => {
  const text = [
    "Example:",
    "```xml",
    "<coven:next-paths>",
    "- [reply] Continue",
    "</coven:next-paths>",
    "```",
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.equal(formatted.copyText, text);
  assert.deepEqual(formatted.pieces, [{ kind: "text", text }]);
  assert.deepEqual(formatted.suggestions, []);
});

test("long Markdown fences can contain shorter fenced next-path examples", () => {
  const text = [
    "````markdown",
    "```xml",
    "<coven:next-paths>",
    "- [reply] Continue",
    "</coven:next-paths>",
    "```",
    "````",
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.equal(formatted.copyText, text);
  assert.deepEqual(formatted.pieces, [{ kind: "text", text }]);
  assert.deepEqual(formatted.suggestions, []);
});

test("long Markdown fences keep nested bare GitHub URLs literal", () => {
  const text = [
    "````markdown",
    "```text",
    "https://github.com/OpenCoven/coven-cave/pull/3982",
    "```",
    "````",
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.equal(formatted.copyText, text);
  assert.deepEqual(formatted.pieces, [{ kind: "text", text }]);
});

test("protocol examples inside Markdown container fences stay literal", () => {
  const blockquote = [
    "> ```xml",
    '> <coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="3982" />',
    "> ```",
  ].join("\n");
  const quoted = formatQuickChatAssistantMessage(blockquote, false);
  assert.equal(quoted.copyText, blockquote);
  assert.deepEqual(quoted.pieces, [{ kind: "text", text: blockquote }]);

  const list = [
    "- ```xml",
    "  <coven:next-paths>",
    "  - [reply] Continue",
    "  </coven:next-paths>",
    "  ```",
  ].join("\n");
  const listed = formatQuickChatAssistantMessage(list, false);
  assert.equal(listed.copyText, list);
  assert.deepEqual(listed.pieces, [{ kind: "text", text: list }]);
  assert.deepEqual(listed.suggestions, []);
});

test("overlapping quoted fence and inline code ranges stay non-executable", () => {
  const text = [
    "> ```x",
    "> ````",
    '> <coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="3982" />',
    "> ```",
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.equal(formatted.copyText, text);
  assert.deepEqual(formatted.pieces, [{ kind: "text", text }]);
});

test("inline delimiters inside block fences cannot suppress later controls", () => {
  const marker = '<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3982" />';
  const text = [
    "~~~text",
    "unmatched ` example",
    "~~~",
    marker,
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.doesNotMatch(formatted.copyText, /coven:github/);
  assert.ok(formatted.pieces.some((piece) => piece.kind === "card"));
});

test("a list delimiter that opens renderer code still yields to following live controls after close", () => {
  const text = [
    "- ```xml",
    "  example",
    "  ```",
    '<coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="3982" />',
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.equal(formatted.copyText, "- ```xml\n  example\n  ```");
  assert.ok(formatted.pieces.some((piece) => piece.kind === "action"));
});

test("indented fence examples cannot activate protocol controls", () => {
  const spaces = [
    "    ```xml",
    '    <coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="3982" />',
    "    https://github.com/OpenCoven/coven-cave/pull/3982",
    "    ```",
  ].join("\n");
  const spaced = formatQuickChatAssistantMessage(spaces, false);
  assert.equal(spaced.copyText, spaces);
  assert.deepEqual(spaced.pieces, [{ kind: "text", text: spaces }]);

  const tabs = [
    "\t```xml",
    "\t<coven:next-paths>",
    "\t- [reply] Continue",
    "\t</coven:next-paths>",
    "\t```",
  ].join("\n");
  const tabbed = formatQuickChatAssistantMessage(tabs, false);
  assert.equal(tabbed.copyText, tabs);
  assert.deepEqual(tabbed.pieces, [{ kind: "text", text: tabs }]);
  assert.deepEqual(tabbed.suggestions, []);
});

test("inline code examples cannot activate protocol controls", () => {
  const text = [
    'Use `<coven:github-action kind="merge" repo="OpenCoven/coven-cave" number="3982" />` for actions.',
    'Use `<coven:skill name="verification-before-completion" stage="running" />` for skills.',
    "Use `<coven:next-paths>",
    "- [reply] Continue",
    "</coven:next-paths>` for suggestions.",
  ].join("\n");

  const formatted = formatQuickChatAssistantMessage(text, false);

  assert.equal(formatted.copyText, text);
  assert.deepEqual(formatted.pieces, [{ kind: "text", text }]);
  assert.deepEqual(formatted.skillUpdates, []);
  assert.deepEqual(formatted.suggestions, []);
});

test("quick-chat strips result markers and exposes familiar-authored results", () => {
  const formatted = formatQuickChatAssistantMessage(
    [
      "Checks complete.",
      '<coven:result id="tests" state="passed" label="Focused tests passed" />',
    ].join("\n"),
    false,
  );

  assert.equal(formatted.copyText, "Checks complete.");
  assert.deepEqual(formatted.pieces, [{ kind: "text", text: "Checks complete." }]);
  assert.deepEqual(formatted.authoredResults, [
    { id: "tests", state: "passed", label: "Focused tests passed", source: "familiar" },
  ]);
  assert.doesNotMatch(formatted.copyText, /coven:result/);
  assert.ok(
    formatted.pieces.every((piece) => piece.kind !== "text" || !piece.text.includes("coven:result")),
  );
});
