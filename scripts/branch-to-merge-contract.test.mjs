// Contract test for the `branch-to-merge` skill.
//
// The skill tells agents how to land a branch on protected `main`. Its value is
// entirely in the facts it asserts — the required check, the PR-only path,
// the no-AI-attribution rule, the evidence-backed retirement route. A skill that
// drifts from those facts is worse than no skill: it is confidently wrong at the
// exact moment an agent is about to mutate `main`.
//
// So pin the claims to the documents that own them. When protection changes,
// this test fails and the skill gets updated in the same PR.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const skill = fs.readFileSync(".agents/skills/branch-to-merge/SKILL.md", "utf8");
const claude = fs.readFileSync("CLAUDE.md", "utf8");
const agents = fs.readFileSync("AGENTS.md", "utf8");
const workflow = fs.readFileSync("docs/workflows/github-work-tracking.md", "utf8");
const claudeProse = claude.replace(/\s+/g, " ");
const skillProse = skill.replace(/\s+/g, " ");

// Derive the check list from CLAUDE.md rather than restating it.
const NUMBER_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];

function backticked(source) {
  return [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function documentedChecks(source = claude) {
  const bullet = /^-[ \t]+Required status checks:[^\n]*(?:\n[ \t]+[^\n]*)*/m.exec(source);
  assert.ok(bullet, "CLAUDE.md no longer states the required status-check policy");
  const declaration =
    /Required status checks:\s+\*\*(?:all\s+)?([A-Z]+)\*\*\s+must pass:\s+((?:`[^`]+`|[^`.])+)\./.exec(bullet[0]);
  assert.ok(declaration, "the policy must state a check count and named required contexts");
  return { word: declaration[1], names: backticked(declaration[2]) };
}

function skillChecks(source = skill) {
  const section = /## Phase 5:[^\n]*\n([\s\S]*?)\n## Phase 6:/.exec(source);
  assert.ok(section, "skill no longer defines the checks and review phase");
  const word = /^([A-Za-z]+)\s+required checks? must pass:/m.exec(section[1])?.[1];
  assert.ok(word, "skill no longer states how many checks are required");
  const names = [...section[1].matchAll(/^-[ \t]+`([^`\n]+)`[ \t]*$/gm)]
    .map((match) => match[1]);
  assert.ok(names.length > 0, "skill no longer lists named required checks");
  return { word, names };
}

test("required-check derivation ignores wrapping and surrounding narrative", () => {
  for (const source of [
    "- Required status checks: **ONE** must pass: `Frontend build`.",
    "- Required status checks:\n  **ONE** must pass:\n  `Frontend build`.\n  `CodeQL` is advisory.\n- Other policy facts.",
  ]) {
    assert.deepEqual(documentedChecks(source), {
      word: "ONE",
      names: ["Frontend build"],
    });
  }
  assert.deepEqual(
    documentedChecks("- Required status checks: **TWO** must pass: `frontend.build`, `native.build`."),
    { word: "TWO", names: ["frontend.build", "native.build"] },
  );
  assert.deepEqual(skillChecks([
    "## Phase 5: Checks and review",
    "",
    "One required check must pass:",
    "",
    "```bash",
    "gh pr checks <#> --required",
    "```",
    "",
    "- `Frontend build`",
    "",
    "Independent advisory-check narrative.",
    "",
    "## Phase 6: Merge",
  ].join("\n")), { word: "One", names: ["Frontend build"] });
  assert.throws(() => documentedChecks("- Other policy: `Frontend build`."));
});

test("skill declares a name and a trigger-bearing description", () => {
  assert.match(skill, /^---\nname: branch-to-merge\n/);
  const description = /\ndescription: (.+)\n/.exec(skill)?.[1];
  assert.ok(description, "missing description");
  for (const trigger of ["merge this", "finish the branch", "open a PR"]) {
    assert.ok(
      description.includes(trigger),
      `description is missing the "${trigger}" trigger`,
    );
  }
});

test("skill lists exactly the required status checks CLAUDE.md documents", () => {
  const documented = documentedChecks();
  const listed = skillChecks();

  assert.deepEqual(
    listed.names,
    documented.names,
    "the skill's check list has drifted from CLAUDE.md",
  );
  assert.equal(
    documented.word,
    NUMBER_WORDS[documented.names.length],
    "CLAUDE.md's numeral disagrees with the list it introduces",
  );
  assert.equal(
    listed.word.toUpperCase(),
    NUMBER_WORDS[listed.names.length],
    "the skill's numeral disagrees with the list it introduces",
  );
});

test("skill offers a PR as the only path onto main", () => {
  assert.ok(skill.includes("A) Continue through a PR"));
  assert.ok(skill.includes("B) Leave as-is"));
  assert.ok(
    !/^\s*[BC]\) (Merge|Squash merge)/m.test(skill),
    "skill must not offer a local merge into the base branch",
  );
  const mergeCommands = skill.match(/^gh pr merge .*$/gm) ?? [];
  assert.ok(
    mergeCommands.includes('gh pr merge <#> --squash --match-head-commit "$expected_head" --subject "$squash_subject" --body "$squash_body"'),
  );
  assert.ok(mergeCommands.every((command) => !command.includes("--delete-branch")));
});

test("skill reuses an existing PR instead of creating a duplicate", () => {
  assert.ok(skill.includes('gh pr list --head "$branch" --base main --state open'));
  assert.ok(skill.includes("If it contains exactly one PR, reuse it"));
  assert.ok(skill.includes("do not run `gh pr create`"));
});

test("skill requires all checks on the exact current PR head", () => {
  assert.ok(skill.includes("expected_head=$(git rev-parse HEAD)"));
  assert.ok(skill.includes("Before and after the watch, require `headRefOid` to equal `$expected_head`"));
  assert.ok(skill.includes("pending, cancelled, stale, missing, or failed context"));
  assert.ok(
    skill.includes('--match-head-commit "$expected_head"'),
    "merge must atomically reject a PR head that changed after verification",
  );
  assert.ok(skill.includes('actual_head=$(gh pr view <#> --json headRefOid --jq .headRefOid)'));
  assert.ok(skill.includes('test "$actual_head" = "$expected_head"'));
  assert.ok(skill.includes("gh pr checks <#> --required"));
  assert.ok(skill.includes("set -euo pipefail"));
});

test("CLAUDE.md documents the same exact-head merge without implicit cleanup", () => {
  const mergeCommands = claude.match(/^gh pr merge .*$/gm) ?? [];
  assert.ok(
    mergeCommands.includes('gh pr merge <#> --squash --match-head-commit "$expected_head" --subject "$squash_subject" --body "$squash_body"'),
  );
  assert.ok(mergeCommands.every((command) => !command.includes("--delete-branch")));
  assert.ok(claude.includes('test "$actual_head" = "$expected_head"'));
  assert.ok(claude.includes("gh pr checks <#> --required"));
  assert.ok(claude.includes("set -euo pipefail"));
});

test("skill mirrors the protected-main policy that governs its PR lifecycle", () => {
  assert.match(
    claudeProse,
    /Commit signatures are \*\*NOT required\*\* \(`required_signatures: false`/,
    "CLAUDE.md no longer documents the optional-signature policy",
  );
  assert.match(skill, /Sign commits when you can, but `required_signatures: false`/);
  assert.ok(!skill.includes("Push rejected — unsigned commit"));

  assert.match(
    claudeProse,
    /Branches do \*\*not\*\* need to be up to date with `main` \(`strict: false`\)/,
    "CLAUDE.md no longer documents non-strict required checks",
  );
  assert.match(skill, /Branch protection sets `strict: false`/);

  assert.match(
    claudeProse,
    /Review conversations are \*\*no longer required to be resolved\*\*/,
    "CLAUDE.md no longer documents the review-conversation policy",
  );
  assert.match(skillProse, /Conversation resolution is \*\*no longer\*\* a merge gate/);

  assert.match(
    claudeProse,
    /page with `reviewThreads\(first:100, after:"<endCursor>"\)` until false/,
    "CLAUDE.md no longer documents review-thread pagination",
  );
  assert.match(claudeProse, /Also page each thread's comments when its comment connection has another page/);
  assert.match(skillProse, /Page with `reviewThreads\(first:100, after:"<endCursor>"\)` until `hasNextPage` is false/);
  assert.match(
    claudeProse,
    /If gate-incomplete, preserve the unit\./,
    "CLAUDE.md must retain fail-closed behavior for incomplete exclusion",
  );
  for (const [name, source] of [["skill", skill], ["CLAUDE.md", claude]]) {
    assert.match(
      source,
      /comments\(first:100\)\{pageInfo\{hasNextPage endCursor\}/,
      `${name}'s initial review query must expose comment pagination`,
    );
  }
  assert.match(
    skillProse,
    /Also page any thread whose `comments` pageInfo has `hasNextPage: true`/,
    "the skill must not omit replies when a review thread has more than 100 comments",
  );
  assert.match(
    skill,
    /node\(id:\$thread\)\{\.\.\. on PullRequestReviewThread\{comments\(first:100,after:\$cursor\)/,
    "the skill must provide a copyable query for paginating comments on a thread",
  );

  assert.match(
    workflow,
    /missing legacy maintenance planes are not made safe by changing trackers/,
    "the canonical workflow must not claim tracker migration implements exclusion",
  );
  assert.match(skill, /automatic retirement still requires the full maintenance gate/);
  assert.match(skill, /Preserve dirty state, foreign locks, inaccessible paths, and unknown\s+owners/);
  assert.match(skill, /CodeQL can run[\s\S]*advisory, not required/);
  assert.doesNotMatch(skill, /CodeQL is retired|code scanning is fully off/);
});

test("skill forbids the bypasses branch protection exists to stop", () => {
  assert.ok(skill.includes("`gh pr merge --admin`"));
  assert.ok(skill.includes("Do not use it"));
  assert.ok(skill.includes("git checkout main && git merge <branch>"));
  assert.ok(
    skill.includes("GH006"),
    "skill must name the error a direct push to main produces",
  );
});

test("skill carries the repository's no-AI-attribution rule", () => {
  assert.ok(
    agents.includes("credit an AI model"),
    "AGENTS.md no longer carries the attribution rule this skill mirrors",
  );
  assert.ok(skill.includes("No AI attribution"));
  assert.ok(skill.includes("ID+username@users.noreply.github.com"));
  assert.ok(skill.includes("node scripts/pr-squash-message.mjs"));
  assert.ok(skill.includes("squash_subject=$(jq -er .subject"));
  assert.ok(skill.includes("squash_body=$(jq -er .body"));
  assert.ok(claude.includes("node scripts/pr-squash-message.mjs"));
});

test("skill uses issue-owned worktrees through the canonical GitHub guide", () => {
  assert.ok(skill.includes("../../../docs/workflows/github-work-tracking.md"));
  assert.ok(agents.includes("docs/workflows/github-work-tracking.md"));
  assert.ok(claude.includes("docs/workflows/github-work-tracking.md"));
  const create = "git worktree add --no-track -b <branch> .worktrees/<slug> origin/main";
  assert.ok(skill.includes(create));
  assert.ok(workflow.includes(create));
  assert.match(skill, /Cave Project 9/);
  assert.match(workflow, /orgs\/OpenCoven\/projects\/9/);
});

test("skill refreshes origin before creating a branch from origin/main", () => {
  const phaseZero = skill.slice(
    skill.indexOf("## Phase 0:"),
    skill.indexOf("## Phase 1:"),
  );
  const fetch = phaseZero.indexOf("git fetch origin");
  const create = phaseZero.indexOf("git worktree add --no-track");
  const ownershipReview = phaseZero.indexOf("28-worktree budget review");

  assert.ok(fetch !== -1, "Phase 0 must refresh origin before branching");
  assert.ok(create !== -1, "Phase 0 must use the no-track creation path");
  assert.ok(
    fetch < create && ownershipReview !== -1 && ownershipReview < create,
    "Phase 0 must refresh origin and review ownership/budget before creation",
  );
});

test("skill separates completion from proof-backed local retirement", () => {
  const closeout = skill.slice(
    skill.indexOf("## Phase 7:"),
    skill.indexOf("## Confirmation requirements"),
  );
  assert.match(closeout, /^pnpm wt:status$/m);
  assert.match(closeout, /Local status is not ownership or deletion authority/);
  assert.match(closeout, /Use \*\*branch-curator\*\* for any removal/);
  assert.match(closeout, /current exact-candidate authority, a local\s+maintenance lease/);
  assert.match(closeout, /fresh owner\/runtime evidence, and the complete deletion\s+proof/);
  assert.match(closeout, /Never bypass `scripts\/worktree-guard\.mjs`/);
  assert.ok(
    skill.includes("git tag -s archive/"),
    "skill must document the archive-tag route for retained commits",
  );
  assert.match(closeout, /A squash merge does not retain the branch's own commits/);
  assert.match(closeout, /Verify the exact remote ref and OID/);
  assert.match(closeout, /stale tracking ref or local-only tag does not count/);
});

test("skill uses GitHub ownership without claiming an atomic execution lease", () => {
  assert.ok(skill.includes("gh issue view <issue-number> --repo OpenCoven/coven-cave --comments"));
  assert.match(skill, /Reuse the issue and its existing worktree/);
  assert.match(skill, /re-read ownership before acting/);
  assert.match(skill, /GitHub assignment and comments\s+are not atomic execution leases/);
  assert.match(skill, /Preserve human-authored dependencies and approvals/);
  assert.match(skill, /Do not commit, push, or merge without the current request's authority/);
  assert.match(skill, /A review-only request stays read-only/);
  assert.match(skill, /A no-push instruction still wins/);
  assert.match(skill, /canonical GitHub issue link/);
});

test("skill records worktree disposition before issue and Project completion", () => {
  const closeout = skill.slice(skill.indexOf("## Phase 7:"));
  assert.ok(closeout.includes("before closing the PR-backed work"));
  assert.match(closeout, /merged PR and exact head, branch, worktree, session, owner, and verification\s+evidence on the issue/);
  assert.match(closeout, /removed and verified, or intentionally preserved with\s+an owner and reason/);
  assert.match(closeout, /Only after merge or the issue's explicit completion criteria/);
  assert.match(closeout, /close the issue and set Project `Done` when\s+authorized/);
  assert.match(closeout, /Local-only or unmerged implementation is not completion/);
  assert.ok(
    closeout.indexOf("Record each worktree") < closeout.indexOf("close the issue"),
    "worktree disposition must be recorded before issue closure",
  );
});

test("skill names verification commands that package.json actually defines", () => {
  const scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
  for (const command of ["typecheck", "lint", "test:app", "test:api", "check:tests-wired"]) {
    assert.ok(scripts[command], `package.json no longer defines ${command}`);
    assert.ok(skill.includes(`pnpm ${command}`), `skill no longer runs pnpm ${command}`);
  }
});

test("every skill named as an integration point actually exists in this repo", () => {
  // A repo-tracked skill is loaded by familiars that may have none of the
  // user-level skill library installed, so pointing at a skill that only
  // exists in someone's home directory sends them after something they cannot
  // invoke.
  const table = /## Integration points\n\n\| Skill \| Integration \|\n\|---\|---\|\n(.*?)(?:\n\n|$)/s.exec(
    skill,
  );
  assert.ok(table, "skill no longer has an integration-points table");

  const named = [...table[1].matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
  assert.ok(named.length > 0, "integration-points table lists no skills");

  const present = new Set(fs.readdirSync(".agents/skills"));
  for (const name of named) {
    assert.ok(present.has(name), `integration point \`${name}\` is not a skill in .agents/skills`);
    const entrypoint = `.agents/skills/${name}/SKILL.md`;
    assert.ok(
      fs.existsSync(entrypoint) && fs.lstatSync(entrypoint).isFile(),
      `integration point \`${name}\` has no regular SKILL.md entrypoint`,
    );
  }
});

test("skill retires Beads recipes without discarding legacy evidence", () => {
  assert.doesNotMatch(skill, /\bbd\s+(?:prime|ready|show|list|create|update|close|sync)\b/);
  assert.doesNotMatch(skill, /\bpnpm\s+beads:/);
  assert.doesNotMatch(skill, /\bdolt\s+(?:push|pull|fetch)\b/);
  assert.doesNotMatch(skill, /\| `beads` \|/);
  assert.match(skill, /Preserve its historical records and refs/);
  assert.match(skill, /Missing evidence or a\s+legacy status does not authorize takeover/);
  assert.match(skill, /Do not manufacture legacy lifecycle\s+metadata or create a Bead/);
  assert.match(skill, /Legacy `retire-after-gate` and `uncertain` classifications do not grant it/);
});

test("skill preserves budgets and uncertainty without reviving the legacy creator", () => {
  assert.match(workflow, /28 registered worktrees/);
  assert.match(workflow, /including its primary worktree/);
  assert.match(workflow, /preserve existing units and\s+obtain an attributed, scoped exception on the issue before creating another/);
  assert.match(skill, /Worktree budget reached \| Preserve existing units/);
  assert.match(skill, /Legacy patrol reports `uncertain` or missing maintenance planes/);
  assert.match(skill, /do not fabricate metadata or run Beads to clear it/);
  assert.doesNotMatch(skill, /--exception-(?:owner|reason|expires-at|path)/);
});

test("skill refuses commits from the primary checkout", () => {
  assert.ok(skill.includes("git rev-parse --path-format=absolute --git-common-dir"));
  assert.ok(skill.includes('test "$root" != "$primary"'));
});

test("no inline code span is split across a newline", () => {
  // CommonMark code spans cannot contain newlines, so a wrapped span renders
  // as literal backticks and breaks copy/paste of the command inside it.
  const withoutFences = skill.replace(/```[\s\S]*?```/g, "");
  for (const [index, line] of withoutFences.split("\n").entries()) {
    const backticks = (line.match(/`/g) ?? []).length;
    assert.equal(
      backticks % 2,
      0,
      `line ${index + 1} leaves a code span open across a newline: ${line.trim()}`,
    );
  }
});
