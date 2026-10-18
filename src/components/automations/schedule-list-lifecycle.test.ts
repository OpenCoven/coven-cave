// @ts-nocheck
// The crons list reads each row's state from Coven's canonical lifecycle and
// withholds pause/resume whenever that state is not live (#5217).
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { AutomationsPanel, ScheduleActionsContext } = await import("./schedule-list.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const text = (node) => node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node.children ?? []);
const auto = (id, status = "ACTIVE") => ({
  id, name: `Cron ${id}`, kind: "cron", status, rrule: "RRULE:FREQ=DAILY;BYHOUR=9", model: null, reasoningEffort: null,
  executionEnvironment: null, cwds: [], tags: [], familiars: [], prompt: "", skillPath: null, scheduleHuman: "daily at 9 AM",
});
const view = (state, freshness, revision = 4) => ({ state, revision: state === "unknown" ? null : revision, timezone: state === "unknown" ? null : "UTC", freshness, readAt: freshness === "checking" ? null : "2026-10-18T12:00:00.000Z" });

async function render(lifecycles, lists) {
  const toggled = [];
  let renderer;
  await act(async () => {
    renderer = create(createElement(ScheduleActionsContext.Provider, {
      value: { runAutomation: () => {}, togglePauseAutomation: (a) => toggled.push(a.id), lifecycleOf: (id) => lifecycles[id], busyId: null },
    }, createElement(AutomationsPanel, {
      active: [], paused: [], unverified: [], failingCount: 0, selectedId: null,
      familiarsById: new Map(), lastRunById: new Map(), onSelect: () => {}, ...lists,
    })));
  });
  return { renderer, toggled };
}

function toggleButton(renderer, name) {
  return renderer.root.findAll((node) => node.type === "button" && typeof node.props["aria-label"] === "string" &&
    /^(Pause|Resume) /.test(node.props["aria-label"]) && node.props["aria-label"].includes(name))[0];
}

test("a live lifecycle drives the label and enables the control", async () => {
  const { renderer, toggled } = await render(
    { a: view("active", "live"), b: view("paused", "live") },
    { active: [auto("a", "PAUSED")], paused: [auto("b", "ACTIVE")] },
  );
  try {
    // The legacy `status` on each record is deliberately the opposite: it is ignored.
    const pause = toggleButton(renderer, "Cron a");
    assert.equal(pause.props["aria-label"], "Pause Cron a");
    assert.equal(pause.props.disabled, false);
    const resume = toggleButton(renderer, "Cron b");
    assert.equal(resume.props["aria-label"], "Resume Cron b");
    await act(async () => resume.props.onClick());
    assert.deepEqual(toggled, ["b"]);
  } finally { await act(async () => renderer.unmount()); }
});

test("a stale or unverifiable state is shown as such and offers no command", async () => {
  const { renderer } = await render(
    { a: view("active", "stale"), c: view("unknown", "unavailable") },
    { active: [auto("a")], unverified: [auto("c")] },
  );
  try {
    const shown = text(renderer.toJSON());
    assert.match(shown, /Active · stale/);
    assert.match(shown, /Not verified · 1/, "unverified rows get their own section");
    const stale = toggleButton(renderer, "Cron a");
    assert.equal(stale.props.disabled, true);
    assert.match(stale.props["aria-label"], /^Pause Cron a: Coven's state is out of date here/);
    const unknown = toggleButton(renderer, "Cron c");
    assert.equal(unknown.props.disabled, true);
    assert.match(unknown.props["aria-label"], /Coven can't be reached/);
    assert.ok(renderer.root.findAll((node) => node.props.role === "img" && node.props["aria-label"] === "Not verified").length >= 1,
      "the status glyph names the unverified state instead of claiming a pause");
  } finally { await act(async () => renderer.unmount()); }
});
