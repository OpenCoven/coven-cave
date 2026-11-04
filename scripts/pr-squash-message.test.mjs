import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "pr-squash-message.mjs");

function prepareMessage(input) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(input),
  });
}

test("strips AI attribution and preserves unique human GitHub trailers", () => {
  const result = prepareMessage({
    title: "Protect squash attribution",
    body: [
      "## Summary",
      "Keep published history human-authored.",
      "",
      "Generated with GitHub Copilot",
      "Made with Claude Code",
      "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
      "Co-authored-by: GPT-5 <23456+gpt-5@users.noreply.github.com>",
      "Co-authored-by: GPT-4o <34567+gpt-4o@users.noreply.github.com>",
      "Co-authored-by: Val Alexander <68980965+BunsDev@users.noreply.github.com>",
    ].join("\n"),
    commits: [
      {
        messageHeadline: "fix: preserve contributor credit",
        messageBody: [
          "Co-authored-by: Val Alexander <68980965+BunsDev@users.noreply.github.com>",
          "Co-authored-by: Jane Doe <12345+jane-doe@users.noreply.github.com>",
          "Co-authored-by: Claude Martin <98765+claude-martin@users.noreply.github.com>",
        ].join("\n"),
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse(result.stdout);
  assert.equal(message.subject, "Protect squash attribution");
  assert.equal(
    message.body,
    [
      "## Summary",
      "Keep published history human-authored.",
      "",
      "Co-authored-by: Val Alexander <68980965+BunsDev@users.noreply.github.com>",
      "Co-authored-by: Jane Doe <12345+jane-doe@users.noreply.github.com>",
      "Co-authored-by: Claude Martin <98765+claude-martin@users.noreply.github.com>",
    ].join("\n"),
  );
  assert.doesNotMatch(message.body, /Copilot|GPT-5|GPT-4o|Generated with|Made with/i);
});

test("refuses ambiguous non-GitHub co-author trailers", () => {
  const result = prepareMessage({
    title: "Protect squash attribution",
    body: "Co-authored-by: Jane Doe <jane@Someones-Mac.local>",
    commits: [],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /numeric GitHub no-reply identity/i);
});

test("refuses malformed co-author lines instead of carrying them forward", () => {
  const result = prepareMessage({
    title: "Protect squash attribution",
    body: "Co-authored-by: Jane Doe jane@example.com",
    commits: [],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed Co-authored-by trailer/i);
});

test("carries Coven-Familiar provenance from commits once and drops the harness and session lines", () => {
  const result = prepareMessage({
    title: "Reconcile familiar provenance",
    body: [
      "Refs #6068",
      "",
      "Coven-Familiar: cody",
      "Coven-Harness: claude / claude-opus-5-5",
      "Coven-Session: 9354681b-f005-40eb-84c6-313798c6590e",
    ].join("\n"),
    commits: [
      {
        messageHeadline: "feat: part one",
        messageBody: [
          "Refs #5930",
          "",
          "Co-authored-by: Jane Doe <12345+jane-doe@users.noreply.github.com>",
          "Coven-Familiar: Cody",
          "Coven-Harness: claude / claude-opus-5-5",
          "Coven-Session: 9354681b-f005-40eb-84c6-313798c6590e",
        ].join("\n"),
      },
      {
        messageHeadline: "feat: part two",
        messageBody: [
          "Coven-Familiar: nova",
          "Coven-Harness: codex / gpt-5-codex",
          "Coven-Session: 7c1d2e3f",
        ].join("\n"),
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  const message = JSON.parse(result.stdout);
  assert.equal(
    message.body,
    [
      "Refs #6068",
      "",
      "Co-authored-by: Jane Doe <12345+jane-doe@users.noreply.github.com>",
      "Coven-Familiar: cody",
      "Coven-Familiar: nova",
    ].join("\n"),
  );
  assert.doesNotMatch(message.body, /Coven-Harness|Coven-Session|claude|codex|gpt/i);
});

test("refuses a malformed Coven-Familiar trailer instead of guessing the familiar", () => {
  const result = prepareMessage({
    title: "Reconcile familiar provenance",
    body: "Refs #6068",
    commits: [{ messageBody: "Coven-Familiar: Cody <cody@opencoven.ai>" }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed Coven-Familiar trailer/i);
});

test("still refuses a familiar address as a co-author", () => {
  const result = prepareMessage({
    title: "Reconcile familiar provenance",
    body: "Refs #6068",
    commits: [{ messageBody: "Co-Authored-By: Nova <nova@opencoven.ai>\nCoven-Familiar: nova" }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /numeric GitHub no-reply identity/i);
});
