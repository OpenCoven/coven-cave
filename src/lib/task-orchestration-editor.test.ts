import assert from "node:assert/strict";
import test from "node:test";
import type { TaskDependency, TaskNextStep } from "./cave-board-types";
import {
  changeDraftDependencies,
  changeDraftNextStep,
  orchestrationDraft,
} from "./task-orchestration-editor.ts";

const at = "2026-09-09T14:00:00.000Z";
const later = "2026-09-09T14:01:00.000Z";
const dependency = (id: string): TaskDependency => ({
  id,
  kind: "external",
  label: `Provision ${id}`,
  ref: `svc:${id}`,
  state: "unresolved",
  origin: "human",
  createdAt: at,
});
const step: TaskNextStep = {
  summary: "Provision the service",
  actorFamiliarId: "sage",
  capability: "service-admin",
  target: "svc:build",
  inputs: ["Keep this human input"],
  requiresApproval: true,
  origin: "human",
  updatedAt: at,
};

test("fresh drafts are independent and never manufacture a review", () => {
  const first = orchestrationDraft();
  const second = orchestrationDraft();
  assert.deepEqual({ ...first }, {
    dependencies: [],
    primaryBlockerId: null,
    primaryBlockerPinned: false,
    nextStep: null,
  });
  first.dependencies.push(dependency("build"));
  assert.equal(second.dependencies.length, 0);
  assert.equal(Object.hasOwn(first, "dependencyReviewAction"), false);
});

test("opening preserves every human field and timestamp without shared mutable objects", () => {
  const card = {
    dependencies: [dependency("build")],
    primaryBlockerId: "build",
    primaryBlockerPinned: true,
    nextStep: step,
  };
  const draft = orchestrationDraft(card);
  assert.deepEqual({ ...draft }, card);
  assert.notEqual(draft.dependencies, card.dependencies);
  assert.notEqual(draft.dependencies[0], card.dependencies[0]);
  assert.notEqual(draft.nextStep, card.nextStep);
  assert.notEqual(draft.nextStep?.inputs, card.nextStep.inputs);
  assert.equal(draft.dependencyReviewAction, undefined);
});

test("removing the primary promotes the next unresolved dependency and preserves the pin", () => {
  const done = { ...dependency("done"), state: "resolved" as const, evidence: "run:123" };
  const draft = {
    ...orchestrationDraft(),
    dependencies: [dependency("first"), done, dependency("second")],
    primaryBlockerId: "first",
    primaryBlockerPinned: true,
    dependencyReviewAction: "review" as const,
  };
  const updated = changeDraftDependencies(draft, draft.dependencies.slice(1));
  assert.equal(updated.primaryBlockerId, "second");
  assert.equal(updated.primaryBlockerPinned, true);
  assert.equal(updated.dependencyReviewAction, undefined);
  assert.equal(draft.primaryBlockerId, "first");
});

test("resolving or waiving the final blocker clears primary and pin", () => {
  const draft = {
    ...orchestrationDraft(),
    dependencies: [dependency("first")],
    primaryBlockerId: "first",
    primaryBlockerPinned: true,
  };
  for (const state of ["resolved", "waived"] as const) {
    const updated = changeDraftDependencies(draft, [{ ...draft.dependencies[0], state }]);
    assert.equal(updated.primaryBlockerId, null);
    assert.equal(updated.primaryBlockerPinned, false);
  }
});

test("reordering keeps stable IDs, a valid primary, and untouched human next steps", () => {
  const first = dependency("first");
  const second = dependency("second");
  const draft = {
    ...orchestrationDraft(),
    dependencies: [first, second],
    primaryBlockerId: "first",
    nextStep: step,
    dependencyReviewAction: "review" as const,
  };
  const updated = changeDraftDependencies(draft, [second, first]);
  assert.deepEqual(updated.dependencies.map((entry) => entry.id), ["second", "first"]);
  assert.equal(updated.primaryBlockerId, "first");
  assert.equal(updated.nextStep, step);
  assert.equal(updated.dependencies[0], second);
  assert.equal(updated.dependencyReviewAction, undefined);
});

test("next-step fields typed before the summary survive and acquire human provenance", () => {
  for (const patch of [
    { actorFamiliarId: "sage" },
    { capability: "service-admin" },
    { target: "svc:build" },
    { inputs: ["first line", ""] },
    { requiresApproval: true },
  ]) {
    const draft = changeDraftNextStep(orchestrationDraft(), patch, at);
    assert.deepEqual(draft.nextStep, {
      summary: "",
      requiresApproval: false,
      ...patch,
      origin: "human",
      updatedAt: at,
    });
    const completed = changeDraftNextStep(draft, { summary: "Provision the service" }, later);
    assert.deepEqual(completed.nextStep, {
      ...draft.nextStep,
      summary: "Provision the service",
      updatedAt: later,
    });
  }
});

test("clearing a summary preserves other inputs; wholly blank next steps become null", () => {
  const draft = orchestrationDraft({ nextStep: step });
  const partial = changeDraftNextStep(draft, { summary: "" }, later);
  assert.equal(partial.nextStep?.summary, "");
  assert.deepEqual(partial.nextStep?.inputs, step.inputs);
  const empty = changeDraftNextStep(partial, {
    actorFamiliarId: null,
    capability: "",
    target: "",
    inputs: ["", " "],
    requiresApproval: false,
  }, later);
  assert.equal(empty.nextStep, null);
  assert.deepEqual(step.inputs, ["Keep this human input"]);
});

test("next-step edits clear stale explicit review without changing unrelated dependencies", () => {
  const draft = {
    ...orchestrationDraft(),
    dependencies: [dependency("build")],
    dependencyReviewAction: "review" as const,
    nextStep: { ...step, origin: "system" as const },
  };
  const updated = changeDraftNextStep(draft, { target: "svc:new-build" }, later);
  assert.equal(updated.dependencyReviewAction, undefined);
  assert.equal(updated.dependencies, draft.dependencies);
  assert.equal(updated.nextStep?.origin, "human");
  assert.equal(updated.nextStep?.updatedAt, later);
  assert.equal(updated.nextStep?.capability, step.capability);
  assert.equal(draft.nextStep.origin, "system");
});
