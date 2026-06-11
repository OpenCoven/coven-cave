// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./debug-pane.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /formatEventPayload\(event\.payload_json\)/,
  "Debug event rows should render through the human-readable payload formatter",
);
assert.match(
  source,
  /whitespace-pre-wrap break-words/,
  "Debug payload blocks should wrap words instead of splitting every character",
);
assert.doesNotMatch(
  source,
  /whitespace-pre-wrap break-all/,
  "Debug payload blocks should not force unreadable break-all wrapping",
);

// ── Changes tab (CHAT-D8-01): working-tree review panel in the right panel ────

const surface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");

assert.match(
  surface,
  /right-panel-changes-header[\s\S]*?Changes/,
  "Chat right panel should expose a persistent Changes half beneath Inspector/Debug",
);
assert.match(
  surface,
  /<Panel[\s\S]*id="right-panel-changes"[\s\S]*<SessionChangesPanel \/>/,
  "Changes half should render SessionChangesPanel persistently",
);

const changesPanel = await readFile(
  new URL("./session-changes-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(
  changesPanel,
  /<SyntaxBlock text=\{diffState\.diff\} lang="diff"/,
  "File diffs should render through SyntaxBlock with diff highlighting",
);
assert.match(
  changesPanel,
  /Two-step revert[\s\S]*?setConfirmRevert\(true\)/,
  "Revert must be two-step: first click arms an inline confirm",
);
assert.match(
  changesPanel,
  /confirmRevert \?[\s\S]*?Cancel[\s\S]*?onRevert\(\)/,
  "Armed revert row offers Cancel and only the explicit confirm commits",
);
assert.match(
  changesPanel,
  /All uncommitted changes in/,
  "Panel caption must be honest that git shows repo-wide changes, not per-session ones",
);
assert.match(
  changesPanel,
  /notARepo\s*\?\s*<>\s*No git working tree at[\s\S]*?:\s*<>\s*All uncommitted changes in/,
  "Panel caption should switch copy when the project is not a git repository",
);
assert.match(
  changesPanel,
  /title=\{untracked \? `Delete \$\{file\.path\}` : `Revert \$\{file\.path\}`\}[\s\S]*?<Icon name=\{untracked \? "ph:trash" : "ph:arrow-counter-clockwise"\}/,
  "Untracked file delete action should use a trash icon before confirm, matching its label",
);
assert.match(
  changesPanel,
  /saveCheckpoint[\s\S]*?action: "checkpoint"[\s\S]*?Checkpoint/,
  "Changes panel should expose a checkpoint action that saves a patch snapshot before risky review/revert work",
);
assert.match(
  changesPanel,
  /checkpointMessage[\s\S]*?Saved checkpoint/,
  "Checkpoint completion should surface the saved patch path in the panel",
);

const changesRoute = await readFile(
  new URL("../app/api/changes/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  changesRoute,
  /execFileAsync\("git", args/,
  "Changes API must shell out via execFile with an argument array",
);
assert.doesNotMatch(
  changesRoute,
  /\bspawn\(|shell:\s*true|(?<!\.)\bexec\(/,
  "Changes API must never run git through a shell",
);
assert.match(
  changesRoute,
  /import \{ resolveAllowedProjectPath \} from "@\/lib\/server\/project-paths"/,
  "Changes API must reuse the repo-standard project-root allow-list",
);
assert.match(
  changesRoute,
  /const allowedRoot = resolveAllowedProjectPath\(projectRoot\);[\s\S]*?if \(!allowedRoot\)[\s\S]*?status: 403/,
  "projectRoot must be denied before git access when it is outside the allowed workspace roots",
);
assert.match(
  changesRoute,
  /fs\.statSync\(real\)[\s\S]*?catch/,
  "projectRoot stat failures must return structured JSON errors instead of throwing",
);
assert.match(
  changesRoute,
  /function resolveContainedFile[\s\S]*?path\.isAbsolute\(relPath\)[\s\S]*?includes\("\.\."\)[\s\S]*?startsWith\(repoRoot \+ path\.sep\)[\s\S]*?fs\.realpathSync\(resolved\)[\s\S]*?startsWith\(repoRoot \+ path\.sep\)/,
  "File paths must pass a resolve + prefix containment check (no absolute paths, no ..)",
);
assert.match(
  changesRoute,
  /code === "ENOENT"[\s\S]*?git unavailable/,
  "git execution failures such as ENOENT should not be mislabeled as not-a-git-repository",
);
assert.match(
  changesRoute,
  /const MAX_GIT_BUFFER = 64 \* 1024 \* 1024/,
  "Changes API should leave enough git stdout buffer headroom for the 200KB diff truncation path",
);
assert.match(
  changesRoute,
  /"path not allowed"[\s\S]*?status: 403/,
  "Containment failures return the repo-standard 403 path-deny error",
);
assert.match(
  changesRoute,
  /confirmUntracked !== true[\s\S]*?requiresConfirmUntracked/,
  "Deleting an untracked file must be gated behind an explicit confirmUntracked flag",
);
assert.match(
  changesRoute,
  /\["clean", "-f", "--", body\.path\]/,
  "Untracked revert is scoped to git clean -f -- <one file>",
);
assert.match(
  changesRoute,
  /\["checkout", "--", body\.path\]/,
  "Tracked revert is scoped to git checkout -- <one file>",
);
assert.match(
  changesRoute,
  /action\?: "revert" \| "checkpoint"/,
  "Changes POST should accept an explicit checkpoint action as a non-destructive review operation",
);
assert.match(
  changesRoute,
  /async function checkpointChanges[\s\S]*?\.git[\s\S]*?coven-cave[\s\S]*?checkpoints/,
  "Checkpoint snapshots should be stored under the repository .git directory, not in the worktree",
);
assert.match(
  changesRoute,
  /\["diff", "--binary", "HEAD", "--"\]/,
  "Checkpoint snapshots should capture binary-safe tracked diffs versus HEAD",
);
assert.match(
  changesRoute,
  /status === "untracked"[\s\S]*?\["diff", "--no-index", "--", "\/dev\/null", abs\]/,
  "Checkpoint snapshots should include untracked file contents as synthetic add-file diffs",
);
assert.match(
  changesRoute,
  /writeFileSync\(checkpointPath, patch/,
  "Checkpoint snapshots should persist the generated patch without changing the working tree",
);

console.log("debug-pane.test.ts: ok");
