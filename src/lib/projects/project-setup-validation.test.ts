// Rules for the "Set up as project" modal's fields and repo suggester.
import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_NAME_MAX,
  applyRepoSuggestion,
  filterRepoSuggestions,
  formatPushedAt,
  projectSetupBlocked,
  titleCaseProjectName,
  validateProjectName,
  validateRepoDraft,
} from "./project-setup-validation.ts";

test("a project must be named, and briefly", () => {
  assert.equal(validateProjectName("Coven Cave"), null);
  assert.match(validateProjectName("") ?? "", /Give the project a name/);
  assert.match(validateProjectName("   ") ?? "", /Give the project a name/, "whitespace is not a name");
  assert.equal(validateProjectName("x".repeat(PROJECT_NAME_MAX)), null, "the limit itself is allowed");
  assert.match(validateProjectName("x".repeat(PROJECT_NAME_MAX + 1)) ?? "", /under 48 characters/);
});

test("the repository is optional, but a non-empty one must be a real GitHub repo", () => {
  assert.equal(validateRepoDraft(""), null, "unlinked projects are first-class");
  assert.equal(validateRepoDraft("   "), null);
  assert.equal(validateRepoDraft("OpenCoven/coven-cave"), null);
  assert.equal(validateRepoDraft("https://github.com/OpenCoven/coven-cave"), null);
  assert.match(validateRepoDraft("not a repo") ?? "", /owner\/repo/);
  assert.match(validateRepoDraft("https://gitlab.com/a/b") ?? "", /owner\/repo/, "only GitHub links normalize");
});

// The bug this guards: live validation and submit validation written twice
// drift, and a field goes green on input that submit then rejects.
test("the submit gate agrees with the per-field rules", () => {
  assert.equal(projectSetupBlocked("Coven Cave", ""), false);
  assert.equal(projectSetupBlocked("Coven Cave", "OpenCoven/coven-cave"), false);
  assert.equal(projectSetupBlocked("", "OpenCoven/coven-cave"), true, "a bad name blocks");
  assert.equal(projectSetupBlocked("Coven Cave", "nonsense"), true, "a bad repo blocks");
});

test("repo slugs become names a human would have typed", () => {
  assert.equal(titleCaseProjectName("hekate-agent"), "Hekate Agent");
  assert.equal(titleCaseProjectName("coven_cli"), "Coven CLI");
  assert.equal(titleCaseProjectName("terminal-ui"), "Terminal UI");
  assert.equal(titleCaseProjectName("coven-cave"), "Coven Cave");
  assert.equal(titleCaseProjectName("iosApp"), "iOS App", "camelCase splits before the acronym map applies");
  assert.equal(titleCaseProjectName("opencoven"), "OpenCoven");
  assert.equal(titleCaseProjectName(""), "");
  // Typing "coven-" mid-word must not jam the next word onto the last one.
  assert.equal(titleCaseProjectName("coven-"), "Coven ");
});

test("suggestions narrow by what is typed, including a pasted URL", () => {
  const repos = [
    { fullName: "OpenCoven/coven-cave", owner: "OpenCoven", name: "coven-cave" },
    { fullName: "OpenCoven/coven-code", owner: "OpenCoven", name: "coven-code" },
    { fullName: "OpenKnots/terminal-ui", owner: "OpenKnots", name: "terminal-ui" },
  ];
  assert.equal(filterRepoSuggestions(repos, "").length, 3, "an empty query shows everything");
  assert.deepEqual(
    filterRepoSuggestions(repos, "terminal").map((r) => r.fullName),
    ["OpenKnots/terminal-ui"],
  );
  assert.equal(filterRepoSuggestions(repos, "OPENCOVEN").length, 2, "matching is case-insensitive");
  assert.deepEqual(
    filterRepoSuggestions(repos, "https://github.com/OpenCoven/coven-code").map((r) => r.fullName),
    ["OpenCoven/coven-code"],
    "a pasted URL still finds the row it names",
  );
  assert.equal(filterRepoSuggestions(repos, "nothing-here").length, 0);
});

test("picking a suggestion fills the repo, and the name only when it is free", () => {
  const repo = { fullName: "OpenCoven/hekate-agent", owner: "OpenCoven", name: "hekate-agent" };
  assert.deepEqual(applyRepoSuggestion(repo, ""), {
    repoDraft: "OpenCoven/hekate-agent",
    name: "Hekate Agent",
  });
  assert.deepEqual(
    applyRepoSuggestion(repo, "My Deliberate Name"),
    { repoDraft: "OpenCoven/hekate-agent", name: "My Deliberate Name" },
    "a name the user already wrote is never overwritten by a later repo pick",
  );
});

test("pushed-at reads as an age, and never as NaN", () => {
  const now = Date.parse("2026-07-29T12:00:00Z");
  assert.equal(formatPushedAt(new Date(now - 30_000).toISOString(), now), "just now");
  assert.equal(formatPushedAt(new Date(now - 27 * 60_000).toISOString(), now), "27m ago");
  assert.equal(formatPushedAt(new Date(now - 2 * 3_600_000).toISOString(), now), "2h ago");
  assert.equal(formatPushedAt(new Date(now - 3 * 86_400_000).toISOString(), now), "3d ago");
  assert.equal(formatPushedAt(null, now), "", "a repo with no push date shows nothing");
  assert.equal(formatPushedAt("not-a-date", now), "", "an unparseable date shows nothing, not NaN");
});

console.log("project-setup-validation.test.ts ✓");
