// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /function gitDiff[\s\S]*\["diff", "--no-ext-diff", "--no-textconv", \.\.\.args\]/,
  "git diff calls must disable external diff helpers and textconv filters",
);

assert.doesNotMatch(
  source,
  /git\(repoRoot, \["diff"/,
  "changes route should use gitDiff for every git diff invocation",
);

assert.match(
  source,
  /function gitStatus[\s\S]*\["-c", "core\.fsmonitor=false", "status", \.\.\.args\]/,
  "git status calls must disable repository-configured fsmonitor commands",
);

assert.match(
  source,
  /gitStatus\(root\.repoRoot, \["--porcelain=v1", "-z", "--untracked-files=all"\]\)/,
  "change-list status polling must use the hardened gitStatus helper",
);


// The status GET carries the current branch (Projects hub Git section) — from
// the existing currentBranch() helper, omitted on unborn repos.
assert.match(
  source,
  /branch = await currentBranch\(repoRoot\);/,
  "listChanges resolves the current branch via the shared helper",
);
assert.match(
  source,
  /NextResponse\.json\(\{ ok: true, repo: true, repoRoot: root\.repoRoot, branch, worktree, files \}\)/,
  "the change-list response includes the branch and worktree fields",
);
assert.match(
  source,
  /files = parsePorcelainZ\(stdout\)\.map\(\(file\) => \(\{[\s\S]{0,180}?revertible: isRepoRelativeFileRevertible\(root, file\.path\),/,
  "the GET list derives per-file revert eligibility at the server authorization boundary",
);
assert.match(
  source,
  /resolveNativeRepoRelativePathWithinProject\([\s\S]{0,160}?root\.projectRoot,[\s\S]{0,80}?root\.repoRoot,[\s\S]{0,80}?repoRelativePath,/,
  "GET eligibility uses the same native path containment semantics as revert",
);

// Linked-worktree detection compares --git-dir with --git-common-dir (they
// only differ in a `git worktree` checkout) — never a path-name heuristic.
assert.match(
  source,
  /\["rev-parse", "--git-dir", "--git-common-dir"\]/,
  "worktreeName resolves worktree-ness from git itself",
);

// PR context (?pr=1) goes through ghCli (execFile, no shell) and the branch
// PR's URL must match the pinned github.com PR shape before it is returned.
assert.match(
  source,
  /ghCli\(repoRoot, \[\s*"pr", "view", branch, "--json", "number,url,state,isDraft",\s*\]\)/,
  "branchPr reads the branch PR via the gh CLI helper",
);
assert.match(
  source,
  /PR_URL_RE\.test\(parsed\.url\)/,
  "branchPr validates the PR URL shape before returning it",
);

// ── Branch menu (?branches=1, switch-branch, create-worktree) ────────────────

// Every user-supplied branch name is gated by the shared strict allow-list
// BEFORE it can reach a git argv — both actions, plus the client mirrors it.
assert.match(
  source,
  /if \(action === "switch-branch"\) \{[\s\S]*?if \(!isSafeBranchName\(branch\)\) \{/,
  "switch-branch validates the branch name with the shared strict rule",
);
assert.match(
  source,
  /if \(action === "create-worktree"\) \{[\s\S]*?if \(!isSafeBranchName\(branch\)\) \{/,
  "create-worktree validates the branch name with the shared strict rule",
);

// switch-branch requires the ref to already exist (local or origin) and uses
// `git switch` — carrying edits when safe, surfacing git's refusal otherwise —
// never a forced checkout.
assert.match(
  source,
  /refExists\(root\.repoRoot, `refs\/heads\/\$\{branch\}`\)/,
  "switch-branch checks for the local ref before switching",
);
assert.match(
  source,
  /refExists\(root\.repoRoot, `refs\/remotes\/origin\/\$\{branch\}`\)/,
  "switch-branch accepts an origin-only branch (git switch dwims the tracking branch)",
);
assert.match(
  source,
  /await git\(root\.repoRoot, \["switch", branch\]\);/,
  "the switch is a plain `git switch` via the argv helper (no shell, no -f)",
);
assert.doesNotMatch(
  source,
  /"switch", "-f"|"switch", "--force"|"checkout", "-f"/,
  "branch switching must never force-discard local state",
);

// create-worktree delegates to the shared provisioning lib (containment under
// .worktrees/, idempotent reuse, origin/main base) rather than reimplementing.
assert.match(
  source,
  /provisionBranchWorktree\(\s*root\.repoRoot,\s*branch,/,
  "create-worktree provisions through the shared issue-worktree-provision lib",
);

// Branch rows carry the absolute path of the worktree that has each branch
// checked out, so the client can offer "open a chat in that worktree" instead
// of a dead disabled row (cave-tmst).
assert.match(
  source,
  /worktree: worktreeDir \? path\.basename\(worktreeDir\) : null,\s*\n\s*worktreePath: worktreeDir,/,
  "branch rows expose both the worktree basename (display) and absolute path (jump target)",
);

// The branch listing marks the current branch and which worktree holds each
// checked-out branch, so the menu can disable non-switchable rows.
assert.match(
  source,
  /\["for-each-ref", "refs\/heads", "--sort=-committerdate", "--format=%\(refname:short\)"\]/,
  "listBranches reads local branches newest-first via for-each-ref",
);
assert.match(
  source,
  /\["worktree", "list", "--porcelain"\]/,
  "listBranches maps branches to their checkouts from the porcelain worktree list",
);
assert.match(
  source,
  /if \(wantBranches !== null\) return await listBranches\(root\.repoRoot\);/,
  "the GET handler routes ?branches=1 to the branch listing",
);
assert.match(
  source,
  /if \(\/\^__\.\*__\$\/\.test\(name\)\) continue;/,
  "tool-internal dunder refs (beads' __dolt_remote_info__) stay out of the menu",
);

assert.match(
  source,
  /function isChangedFile[\s\S]*?changedFilePaths[\s\S]*?parsePorcelainZ/,
  "direct diff/revert requests must be authorized against git status, not guessed ignored files",
);
assert.match(
  source,
  /function changedFilePaths[\s\S]*?const args = \["--porcelain=v1", "-z", "--untracked-files=all"\][\s\S]*?gitStatus\(repoRoot, args\)/,
  "the diff/revert authorization set must come from the hardened gitStatus helper (fsmonitor disabled)",
);
assert.match(
  source,
  /if \(!\(await isChangedFile\(root\.repoRoot, filePath\)\)\) return pathNotAllowed\(\);/,
  "single-file diff requests should only serve paths present in git status",
);
assert.match(
  source,
  /resolveNativeRepoRelativePathWithinProject\(\s*root\.projectRoot,\s*root\.repoRoot,\s*body\.repoRelativePath!,\s*\)[\s\S]{0,160}?resolveContainedFile\(root\.projectRoot, projectTarget\.projectRelativePath\)/,
  "revert authorizes repo-relative list paths through the shared captured-project boundary",
);
assert.match(
  source,
  /isChangedFile\(root\.repoRoot, projectTarget\.gitRelativePath, root\.projectPathspec\)/,
  "revert authorization uses the project-validated git-root-relative target",
);
assert.match(
  source,
  /"checkout",[\s\S]{0,100}?literalGitPathspec\(projectTarget\.gitRelativePath\)[\s\S]{0,500}?\["rm", "-f", "--", literalGitPathspec\(projectTarget\.gitRelativePath\)\][\s\S]{0,350}?\["clean", "-f", "--", literalGitPathspec\(projectTarget\.gitRelativePath\)\]/,
  "every destructive revert argv uses only the literal project-validated git-relative path",
);
assert.match(
  source,
  /const allowedRoot = await isAllowed\(projectRoot\);[\s\S]*?git\(real, \["rev-parse", "--show-toplevel"\]\)[\s\S]*?projectPathspecForGitRoot\(real, repoRoot\)[\s\S]*?if \(!\(await isAllowed\(repoRoot\)\)\)/,
  "root resolution authorizes both the captured project and its enclosing Git repository",
);
assert.match(
  source,
  /if \(!projectPathspec\) \{[\s\S]{0,120}?status: 403[\s\S]{0,120}?if \(!\(await isAllowed\(repoRoot\)\)\)/,
  "an unproven or unauthorized enclosing Git root fails closed",
);
assert.doesNotMatch(
  source,
  /scoped-revert/,
  "scoped Undo cannot bypass the existing enclosing-repository authorization policy",
);
assert.match(
  source,
  /checkpointChanges\(root\.repoRoot, \{\s*kind: "revert-target",\s*projectRoot: root\.projectRoot,\s*targetProjectRelativePath: projectTarget\.projectRelativePath,\s*targetGitPath: projectTarget\.gitRelativePath,/,
  "the revert safety checkpoint is constrained to the exact destructive target",
);
assert.match(
  source,
  /scope\.kind === "revert-target"[\s\S]{0,120}?scope\.targetGitPath[\s\S]{0,120}?scope\.projectPathspec[\s\S]{0,180}?\["--binary", "--no-renames", "HEAD", "--", scopedPathspec\]/,
  "automatic checkpoint diffs use one literal target pathspec with rename detection disabled",
);
assert.match(
  source,
  /function checkpointAuthorizedForProject\([\s\S]*?nativeProjectPathsEqual\(metadata\.projectRoot, root\.projectRoot\)[\s\S]*?nativeGitRelativePathsEqual\(target\.gitRelativePath, metadata\.targetGitPath\)/,
  "scoped checkpoint operations require metadata for the exact captured project and target",
);
assert.match(
  source,
  /checkpointChanges\(root\.repoRoot, \{\s*kind: "project-scope",\s*projectRoot: root\.projectRoot,\s*projectPathspec: root\.projectPathspec,/,
  "manual checkpoints persist the resolved project's explicit aggregate pathspec",
);
assert.match(
  source,
  /if \(!metadata\) return nativeProjectPathsEqual\(root\.projectRoot, root\.repoRoot\)/,
  "legacy repo-wide checkpoints are authorized only from the enclosing repository",
);
assert.match(
  source,
  /changedFilePaths\(root\.repoRoot, root\.projectPathspec\)[\s\S]{0,900}?\["add", "-A", "--", projectPathspec\][\s\S]{0,300}?"--only",\s*"--",\s*projectPathspec/,
  "commit status, staging, and commit path selection all stay inside the resolved project",
);
assert.match(
  source,
  /nativeGitRelativePathIdentityKey\(file\.path\)[\s\S]{0,260}?nativeGitRelativePathIdentityKey\(relPath\)/,
  "status membership uses host-native Git path identity rather than rebuilt root casing",
);
assert.match(
  source,
  /checkpointPatchPathAuthorized\([\s\S]*?resolveNativeRepoRelativePathWithinProject\([\s\S]*?gitWithInput\([\s\S]*?\["apply", "--3way", "--whitespace=nowarn", "-"\]/,
  "restore validates every patch path against metadata before applying the same buffered patch",
);
assert.match(
  source,
  /if \(!isPostAction\(requestedAction\)\) \{[\s\S]{0,180}?unsupported action/,
  "unknown aggregate actions cannot fall through to the revert path",
);

// remote=1 — read-only origin probe powering the project-setup modal's GitHub
// prefill. Must ride the same resolveRepoRoot containment as every other GET
// mode and go through execFile argv (no shell); an absent origin is a normal
// state (null), never an error. The returned URL is normalized server-side
// (via normalizeGitHubRepoUrl) so credential-bearing or non-GitHub remotes
// never reach the client.
assert.match(
  source,
  /if \(wantRemote !== null\) return await originRemoteUrl\(root\.repoRoot\);/,
  "remote=1 resolves through the shared resolveRepoRoot containment",
);
assert.match(
  source,
  /\["config", "--get", "remote\.origin\.url"\]/,
  "the origin probe reads git config through argv, not a shell",
);
assert.match(
  source,
  /normalizeGitHubRepoUrl\(remoteUrl\)/,
  "the raw origin URL is normalized server-side before returning to the client",
);
assert.match(
  source,
  /NextResponse\.json\(\{ ok: true, remoteUrl: normalizeGitHubRepoUrl\(remoteUrl\) \}\)/,
  "absent or non-GitHub remotes resolve to remoteUrl: null after normalization",
);
assert.match(
  source,
  /catch[\s\S]{0,200}?NextResponse\.json\(\{ ok: true, remoteUrl: null \}\)/,
  "the absent-origin catch branch still answers ok:true with a null remoteUrl",
);

console.log("changes route.test.ts: ok");
