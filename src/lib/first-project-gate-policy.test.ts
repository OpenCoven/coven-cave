import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveFirstProjectGatePolicy } from "./first-project-gate-policy.ts";

const project = { id: "p1", name: "Project", root: "/repo", createdAt: "now", updatedAt: "now" };
const visibleFamiliars = [{ id: "sage" }, { id: "ember" }];

test("first-project gate policy opens only on Home/Chat once onboarding, roster, and projects are resolved", () => {
  assert.deepEqual(
    resolveFirstProjectGatePolicy({
      activeFamiliarId: "sage",
      visibleFamiliars,
      registeredProjects: [],
      pendingGrant: null,
      onboardingResolved: true,
      onboardingOpen: false,
      mode: "home",
      familiarsLoaded: true,
      familiarRosterLoadedSuccessfully: true,
      projectsInitiallyResolved: true,
    }),
    { open: true, familiarId: "sage" },
    "zero projects opens the gate on Home once the shared eligibility checks pass",
  );

  assert.equal(
    resolveFirstProjectGatePolicy({
      activeFamiliarId: "sage",
      visibleFamiliars,
      registeredProjects: [],
      pendingGrant: null,
      onboardingResolved: true,
      onboardingOpen: false,
      mode: "agents",
      familiarsLoaded: true,
      familiarRosterLoadedSuccessfully: true,
      projectsInitiallyResolved: true,
    }).open,
    false,
    "non-chat navigation stays usable because the gate hides outside Home/Chat",
  );

  assert.equal(
    resolveFirstProjectGatePolicy({
      activeFamiliarId: "sage",
      visibleFamiliars,
      registeredProjects: [],
      pendingGrant: null,
      onboardingResolved: false,
      onboardingOpen: false,
      mode: "home",
      familiarsLoaded: true,
      familiarRosterLoadedSuccessfully: true,
      projectsInitiallyResolved: true,
    }).open,
    false,
    "the gate waits for onboarding resolution",
  );
});

test("first-project gate policy keeps a pending retry bound to its original familiar and reopens only on Home/Chat", () => {
  const pendingGrant = {
    familiarId: "ember",
    project: { id: "p1", name: "Project", root: "/repo" },
  };

  assert.deepEqual(
    resolveFirstProjectGatePolicy({
      activeFamiliarId: "sage",
      visibleFamiliars,
      registeredProjects: [project],
      pendingGrant,
      onboardingResolved: true,
      onboardingOpen: false,
      mode: "chat",
      familiarsLoaded: true,
      familiarRosterLoadedSuccessfully: true,
      projectsInitiallyResolved: true,
    }),
    { open: true, familiarId: "ember" },
    "a valid pending retry stays bound to its original familiar even when another familiar is active",
  );

  assert.deepEqual(
    resolveFirstProjectGatePolicy({
      activeFamiliarId: "sage",
      visibleFamiliars,
      registeredProjects: [project],
      pendingGrant,
      onboardingResolved: true,
      onboardingOpen: false,
      mode: "board",
      familiarsLoaded: true,
      familiarRosterLoadedSuccessfully: true,
      projectsInitiallyResolved: true,
    }),
    { open: false, familiarId: "ember" },
    "the same pending retry hides on non-Home/Chat surfaces and can reopen later without losing its target",
  );
});
