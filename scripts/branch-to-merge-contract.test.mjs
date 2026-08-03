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
  assert.ok(skill.includes("A) Open a PR"));
  assert.ok(skill.includes("B) Leave as-is"));
  assert.ok(
    !/^\s*[BC]\) (Merge|Squash merge)/m.test(skill),
    "skill must not offer a local merge into the base branch",
  );
  assert.ok(skill.includes("gh pr merge <#> --squash --delete-branch"));
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

test("skill names verification commands that package.json actually defines", () => {
  const scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
  for (const command of ["typecheck", "lint", "test:app", "test:api", "check:tests-wired"]) {
    assert.ok(scripts[command], `package.json no longer defines ${command}`);
    assert.ok(skill.includes(`pnpm ${command}`), `skill no longer runs pnpm ${command}`);
  }
});
