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

test("settled quick-chat text replaces GitHub markers and next-path trailers with readable UI data", () => {
  const formatted = formatQuickChatAssistantMessage(
    [
      "Ready for review.",
      '<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3982" />',
      "<coven:next-paths>",
      "- Open the pull request",
      "- Review the diff",
      "</coven:next-paths>",
    ].join("\n"),
    false,
  );

  assert.equal(formatted.copyText, "Ready for review.");
  assert.deepEqual(formatted.suggestions, ["Open the pull request", "Review the diff"]);
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
