// Contract test for the `branch-to-merge` skill.
//
// The skill tells agents how to land a branch on protected `main`. Its value is
// entirely in the facts it asserts — the nine required checks, the PR-only path,
// the no-AI-attribution rule, the lifecycle retirement route. A skill that
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

// Derive the check list from CLAUDE.md rather than restating it. A hardcoded
// list only catches removals, and the change that actually happened here was an
// addition (five contexts widened to nine on 2026-08-01) — which a
// presence-only assertion sails straight past.
const NUMBER_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];

function backticked(source) {
  return [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function documentedChecks() {
  const bullet =
    /- Required status checks — \*\*all ([A-Z]+)\*\* must pass[^:]*:(.*?)\. The four matrix legs/s.exec(
      claude,
    );
  assert.ok(bullet, "CLAUDE.md no longer states the required status checks in the expected shape");
  return { word: bullet[1], names: backticked(bullet[2]) };
}

function skillChecks() {
  const section = /required checks must pass:\n\n```bash\n.*?```\n\n(.*?)\n\nCodeQL is retired/s.exec(
    skill,
  );
  assert.ok(section, "skill no longer lists the required checks in the expected shape");
  const word = /\n([A-Za-z]+) required checks must pass:/.exec(skill)?.[1];
  assert.ok(word, "skill no longer states how many checks are required");
  return { word, names: backticked(section[1]) };
}

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
    mergeCommands.includes('gh pr merge <#> --squash --match-head-commit "$expected_head"'),
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

test("CLAUDE.md documents the same exact-head, patrol-safe merge", () => {
  const mergeCommands = claude.match(/^gh pr merge .*$/gm) ?? [];
  assert.ok(
    mergeCommands.includes('gh pr merge <#> --squash --match-head-commit "$expected_head"'),
  );
  assert.ok(mergeCommands.every((command) => !command.includes("--delete-branch")));
  assert.ok(claude.includes('test "$actual_head" = "$expected_head"'));
  assert.ok(claude.includes("gh pr checks <#> --required"));
  assert.ok(claude.includes("set -euo pipefail"));
});

test("skill mirrors the protected-main policy that governs its PR lifecycle", () => {
  assert.match(
    claude,
    /Commit signatures are \*\*NOT required\*\* \(`required_signatures: false`/,
    "CLAUDE.md no longer documents the optional-signature policy",
  );
  assert.match(skill, /Sign commits when you can, but `required_signatures: false`/);
  assert.ok(!skill.includes("Push rejected — unsigned commit"));

  assert.match(
    claude,
    /Branches do \*\*not\*\* need to be up to date with `main` \(`strict: false`\)/,
    "CLAUDE.md no longer documents non-strict required checks",
  );
  assert.match(skill, /Branch protection sets `strict: false`/);

  assert.match(
    claude,
    /Review conversations are \*\*no longer required to be resolved\*\*/,
    "CLAUDE.md no longer documents the review-conversation policy",
  );
  assert.match(skill, /Conversation resolution is \*\*no longer\*\* a merge\ngate/);

  assert.match(
    claude,
    /If hasNextPage is true, page with `reviewThreads\(first:100, after:"<endCursor>"\)`/,
    "CLAUDE.md no longer documents review-thread pagination",
  );
  assert.match(skill, /Page with `reviewThreads\(first:100, after:"<endCursor>"\)` until `hasNextPage` is/);
  assert.match(
    skill,
    /comments\(first:100\)\{pageInfo\{hasNextPage endCursor\}/,
    "the initial review-thread query must read every comment on ordinary threads",
  );
  assert.match(
    skill,
    /Also page any thread whose\n`comments` pageInfo has `hasNextPage: true`/,
    "the skill must not omit replies when a review thread has more than 100 comments",
  );
  assert.match(
    skill,
    /node\(id:\$thread\)\{\.\.\. on PullRequestReviewThread\{comments\(first:100,after:\$cursor\)/,
    "the skill must provide a copyable query for paginating comments on a thread",
  );

  assert.match(
    claude,
    /gate-incomplete, preserve the unit/,
    "CLAUDE.md no longer documents the lifecycle gate-incomplete behavior",
  );
  assert.match(skill, /or the gate as incomplete, \*\*preserve it\*\*/);
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
});

test("skill uses the managed worktree command in its documented form", () => {
  assert.ok(skill.includes("pnpm beads:worktrees:create --bead"));
  assert.ok(
    !skill.includes("beads:worktrees:create -- --bead"),
    "the `--` form is rejected by the flag parser",
  );
  assert.ok(skill.includes("--exception-owner"));
  assert.ok(skill.includes("--exception-expires-at"));
});

test("skill refreshes origin before creating a branch from origin/main", () => {
  const phaseZero = skill.slice(
    skill.indexOf("## Phase 0:"),
    skill.indexOf("## Phase 1:"),
  );
  const fetch = phaseZero.indexOf("git fetch origin");
  const managedCreate = phaseZero.indexOf("pnpm beads:worktrees:create");
  const fallbackCreate = phaseZero.indexOf("git worktree add -b <branch>");

  assert.ok(fetch !== -1, "Phase 0 must refresh origin before branching");
  assert.ok(
    fetch < managedCreate && fetch < fallbackCreate,
    "Phase 0 must refresh origin before either worktree creation path",
  );
});

test("skill retires local units through the patrol, never by improvisation", () => {
  assert.ok(/^pnpm beads:worktrees(?:\s|$)/m.test(skill), "skill must run the report-only patrol");
  assert.ok(skill.includes("pnpm beads:worktrees:apply"));
  assert.ok(skill.includes("branch-curator"));
  assert.ok(
    skill.includes("git tag -s archive/"),
    "skill must document the archive-tag route for retained commits",
  );
});

test("skill bookends the work with Beads claim and close", () => {
  assert.ok(skill.includes("bd update <id> --claim"));
  assert.ok(skill.includes("bd close <id>"));
});

test("skill records the lifecycle patrol before closing the Bead", () => {
  const closeout = skill.slice(skill.indexOf("## Phase 7:"));
  assert.ok(closeout.includes("before closing the PR-backed work"));
  assert.ok(
    closeout.indexOf("pnpm beads:worktrees") < closeout.indexOf("bd close <id>"),
    "the patrol evidence must be recorded before bd close",
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

test("skill handles a managed-worktree inventory outage without forging metadata", () => {
  const normalizedAgents = agents.replace(/\s+/g, " ");
  assert.ok(
    normalizedAgents.includes("lifecycle inventory") &&
      normalizedAgents.includes("git worktree add -b <branch> .worktrees/<branch> origin/main"),
    "AGENTS.md no longer documents the managed-worktree fallback",
  );
  assert.ok(skill.includes("git worktree add -b <branch> .worktrees/<branch> origin/main"));
  assert.ok(skill.includes("can never retire it automatically"));
  assert.ok(skill.includes("never hand-write lifecycle metadata onto the Bead"));
});

test("skill distinguishes a managed-worktree budget refusal from an inventory outage", () => {
  assert.match(
    skill,
    /\| `worktree-lifecycle-create` budget refusal \| Rerun with the printed `--exception-\*` flags\. Do not fall back to `git worktree add` for a budget refusal\. \|/,
    "a budget refusal must use its exception flags, while an inventory outage uses the documented fallback",
  );
  assert.ok(
    skill.includes("If the command cannot build its complete lifecycle\n  inventory"),
    "an inventory outage must retain the documented bare-worktree fallback",
  );
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
