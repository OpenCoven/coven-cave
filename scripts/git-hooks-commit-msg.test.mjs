import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookSource = path.join(root, "scripts", "git-hooks", "commit-msg");
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bashCommand = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";

function runHook(message) {
  const dir = mkdtempSync(path.join(tmpdir(), "coven-cave-commit-msg-test-"));
  const hooksDir = path.join(dir, "scripts", "git-hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, "commit-msg");
  cpSync(hookSource, hook);
  chmodSync(hook, 0o755);
  const messageFile = path.join(dir, "message");
  writeFileSync(messageFile, message);
  return spawnSync(bashCommand, [hook, messageFile], { cwd: dir, encoding: "utf8" });
}

{
  const result = runHook("fix: preserve human credit\n\nCo-authored-by: Val Alexander <68980965+BunsDev@users.noreply.github.com>\n");
  assert.equal(result.status, 0, result.stderr);
}

{
  const result = runHook("fix: preserve a human whose name overlaps a model\n\nCo-authored-by: Claude Martin <98765+claude-martin@users.noreply.github.com>\n");
  assert.equal(result.status, 0, result.stderr);
}

{
  const result = runHook("fix: reject vendor attribution\n\nCo-authored-by: Claude Fable 5 <noreply@anthropic.com>\n");
  assert.notEqual(result.status, 0, "AI/vendor co-author trailers must be blocked");
  assert.match(result.stderr, /numeric no-reply identity/i);
}

{
  const result = runHook("fix: reject linked assistant attribution\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>\n");
  assert.notEqual(result.status, 0, "numeric GitHub identities for AI assistants must be blocked");
  assert.match(result.stderr, /AI model, assistant, vendor, or coding harness/i);
}

{
  const result = runHook("fix: reject generated footer\n\nGenerated with GitHub Copilot\n");
  assert.notEqual(result.status, 0, "AI-generated attribution footers must be blocked");
  assert.match(result.stderr, /AI model, assistant, vendor, or coding harness/i);
}

{
  const result = runHook("fix: reject broader AI attribution\n\nCo-authored-by: Anthropic <12345+anthropic@users.noreply.github.com>\n");
  assert.notEqual(result.status, 0, "AI vendor identities must be blocked");
  assert.match(result.stderr, /AI model, assistant, vendor, or coding harness/i);
}

{
  const result = runHook("fix: reject alphanumeric model login\n\nCo-authored-by: GPT-4o <12345+gpt-4o@users.noreply.github.com>\n");
  assert.notEqual(result.status, 0, "alphanumeric GPT model identities must be blocked");
  assert.match(result.stderr, /AI model, assistant, vendor, or coding harness/i);
}

{
  const result = runHook("fix: reject alternate generated footer\n\nMade with Claude Code\n");
  assert.notEqual(result.status, 0, "alternate AI attribution footers must be blocked");
  assert.match(result.stderr, /AI model, assistant, vendor, or coding harness/i);
}

{
  const result = runHook("fix: reject machine address\n\nCo-authored-by: Jane Doe <jane@Someones-Mac.local>\n");
  assert.notEqual(result.status, 0, "machine-local co-author trailers must be blocked");
  assert.match(result.stderr, /users\.noreply\.github\.com/i);
}



{
  const result = runHook(
    "feat: accept familiar provenance trailers\n\nCoven-Familiar: cody\nCoven-Harness: claude / claude-opus-5-5\nCoven-Session: 9354681b-f005-40eb-84c6-313798c6590e\n",
  );
  assert.equal(result.status, 0, result.stderr);
}

{
  const result = runHook("feat: accept a Codex harness line\n\nCoven-Familiar: nova\nCoven-Harness: codex / gpt-5-codex\n");
  assert.equal(result.status, 0, result.stderr);
}

{
  const result = runHook("feat: reject the familiar co-author form\n\nCo-Authored-By: Cody <cody@opencoven.ai>\nCoven-Familiar: cody\n");
  assert.notEqual(result.status, 0, "familiar <id>@opencoven.ai co-author trailers stay blocked (option A, #6068)");
  assert.match(result.stderr, /numeric no-reply identity/i);
}

{
  const result = runHook("feat: reject a familiar address without a listed AI name\n\nCo-Authored-By: Nova <nova@opencoven.ai>\n");
  assert.notEqual(result.status, 0, "every non-GitHub co-author address is blocked, not only listed AI names");
  assert.match(result.stderr, /numeric no-reply identity/i);
}

console.log("git-hooks-commit-msg.test.mjs: ok");
