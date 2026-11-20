// @ts-nocheck
// Rows name what Coven's scheduler reports each automation doing right now,
// each state by its own label, and the list says when that cannot be trusted (#5217).
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { AutomationsPanel, ScheduleActionsContext } = await import("./schedule-list.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const text = (node) => node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node.children ?? []);
const auto = (id) => ({
  id, name: `Cron ${id}`, kind: "cron", status: "ACTIVE", rrule: "RRULE:FREQ=DAILY;BYHOUR=9", model: null, reasoningEffort: null,
  executionEnvironment: null, cwds: [], tags: [], familiars: [], prompt: "", skillPath: null, scheduleHuman: "daily at 9 AM",
});
const live = { state: "active", revision: 4, timezone: "UTC", freshness: "live", readAt: "2026-10-18T12:00:00.000Z" };
const entry = (state, count = 1) => ({ state, count, since: "2026-10-18T09:00:00.000Z", manual: false });

async function render(inFlight, extra = {}) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(ScheduleActionsContext.Provider, {
      value: { runAutomation: () => {}, togglePauseAutomation: () => {}, lifecycleOf: () => live, inFlightOf: (id) => inFlight[id] ?? { entry: null, freshness: "live" }, busyId: null },
    }, createElement(AutomationsPanel, {
      active: [auto("a"), auto("b"), auto("c"), auto("d")], paused: [], unverified: [], failingCount: 0, selectedId: null,
      familiarsById: new Map(), lastRunById: new Map(), onSelect: () => {}, ...extra,
    })));
  });
  return renderer;
}

test("each row names its own current state, and a row with nothing in flight shows none", async () => {
  const renderer = await render({
    a: { entry: entry("recovery_required"), freshness: "live" },
    b: { entry: entry("running", 2), freshness: "live" },
    c: { entry: entry("claimed"), freshness: "stale" },
  });
  try {
    const rows = renderer.root.findAll((node) => node.type === "li").map(text);
    assert.match(rows[0], /Recovery required/);
    assert.match(rows[1], /Running · 2/);
    assert.match(rows[2], /Claimed · stale/);
    assert.doesNotMatch(rows[3], /Recovery required|Running|Claimed|Due/);
    const tag = renderer.root.findAll((node) => node.type === "span" && typeof node.props.title === "string" && /in Coven, the oldest for/.test(node.props.title));
    assert.equal(tag.length, 3, "each state carries its explanation");
  } finally { await act(async () => renderer.unmount()); }
});

test("the list says when rows cannot show what is running", async () => {
  const renderer = await render({}, { inFlightNote: "Couldn't read what is running from Coven, so rows don't show it." });
  try {
    const note = renderer.root.findAll((node) => node.type === "p" && node.props.role === "note");
    assert.equal(text(note[0]), "Couldn't read what is running from Coven, so rows don't show it.");
  } finally { await act(async () => renderer.unmount()); }
});
