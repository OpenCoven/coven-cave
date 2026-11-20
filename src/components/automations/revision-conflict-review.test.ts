// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { RevisionConflictReview } = await import("./revision-conflict-review.tsx");
const { reviewRevisionRebase } = await import("../../lib/automations/revision-rebase.ts");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const text = (node) => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const button = (renderer, pattern) => renderer.root.findAllByType("button").find((node) => pattern.test(text(node)));
const base = {
  id: "nightly", name: "Nightly digest", kind: "cron", status: "ACTIVE", rrule: "RRULE:FREQ=DAILY;BYHOUR=9",
  model: null, reasoningEffort: null, executionEnvironment: null, cwds: [], tags: ["digest"], familiars: [],
  prompt: "Summarize the day.", skillPath: null, scheduleHuman: "Daily at 09:00",
};
const theirs = { ...base, name: "Evening digest", prompt: "Summarize the evening.", status: "PAUSED" };
const rebase = reviewRevisionRebase(base, { name: "Morning digest", prompt: base.prompt, rrule: base.rrule, model: "opus", tags: base.tags, cwds: [] }, theirs, 6);

function mount(extra = {}) {
  const calls = { saved: [], usedTheirs: 0, kept: 0 };
  const element = createElement(RevisionConflictReview, {
    rebase, busy: false,
    onSaveMine: (patch, revision) => calls.saved.push({ patch, revision }),
    onUseTheirs: () => { calls.usedTheirs += 1; },
    onKeepEditing: () => { calls.kept += 1; },
    ...extra,
  });
  return { calls, element };
}

test("the review says what changed on each side and blocks saving until the conflict is chosen", async () => {
  const { calls, element } = mount();
  let renderer;
  await act(async () => { renderer = create(element); });
  const shown = text(renderer.toJSON());
  assert.match(shown, /Coven has a newer revision/);
  assert.match(shown, /Coven now holds revision 6/);
  assert.match(shown, /Coven's revision is paused; it was active\. Saving never changes this\./);
  assert.match(shown, /Instructions: changed in Coven to .*Summarize the evening\..*Coven's value stays/);
  assert.match(shown, /Model: your change, .*opus.*, will be re-applied/);
  assert.match(shown, /Name: changed by you and in Coven/);
  assert.match(shown, /Choose a value for Name first\./);
  const save = button(renderer, /Save my changes on revision 6/);
  assert.equal(save.props.disabled, true);

  const radios = renderer.root.findAll((node) => node.type === "input" && node.props.type === "radio");
  assert.equal(radios.length, 2);
  assert.equal(radios[0].props.name, radios[1].props.name, "one group per conflicting field");
  await act(async () => radios[1].props.onChange());
  assert.equal(button(renderer, /Save my changes on revision 6/).props.disabled, false);
  await act(async () => button(renderer, /Save my changes on revision 6/).props.onClick());
  // Coven's name is kept by leaving it out; only the model edit is re-applied.
  assert.deepEqual(calls.saved, [{ patch: { model: "opus" }, revision: 6 }]);
  await act(async () => renderer.unmount());
});

test("using Coven's version or keeping the edit writes nothing", async () => {
  const { calls, element } = mount();
  let renderer;
  await act(async () => { renderer = create(element); });
  await act(async () => button(renderer, /Use Coven's version/).props.onClick());
  await act(async () => button(renderer, /Keep editing/).props.onClick());
  assert.deepEqual(calls, { saved: [], usedTheirs: 1, kept: 1 });
  await act(async () => renderer.unmount());
});

test("when nothing of the edit remains, saving is refused with the reason", async () => {
  const same = reviewRevisionRebase(base, { name: "Evening digest" }, theirs, 6);
  const { element } = mount({ rebase: same });
  let renderer;
  await act(async () => { renderer = create(element); });
  assert.match(text(renderer.toJSON()), /None of your edits remain to save/);
  assert.equal(button(renderer, /Save my changes/).props.disabled, true);
  await act(async () => renderer.unmount());
});

test("focus moves to the review heading so keyboard users land on it", async () => {
  const { element } = mount();
  let focused = 0;
  let renderer;
  await act(async () => {
    renderer = create(element, { createNodeMock: (node) => node.type === "h3" ? { focus: () => { focused += 1; } } : null });
  });
  assert.equal(focused, 1);
  await act(async () => renderer.unmount());
});
