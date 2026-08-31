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
  assert.doesNotMatch(message.body, /Copilot|GPT-5|Generated with|Made with/i);
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
