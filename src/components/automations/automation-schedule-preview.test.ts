// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
await import("../../../scripts/test-alias-register.mjs");
const { AutomationSchedulePreview } = await import("./automation-schedule-preview.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const text = (node) => node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node.children ?? []);
// A fixed instant: the preview is computed from `nowMs`, never the wall clock.
const nowMs = Date.parse("2026-10-18T05:00:00.000Z");
const paused = { state: "paused", revision: 3, timezone: "America/Chicago", freshness: "live", readAt: "2026-10-18T05:00:00.000Z" };
const health = { nextDueAt: "2026-10-18T14:00:00.000Z", lastPlannedAt: null, lastStartedAt: null, lastSuccessAt: null, consecutiveFailures: 0, quarantined: false };

async function render(props) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(AutomationSchedulePreview, {
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", savedRrule: "RRULE:FREQ=DAILY;BYHOUR=9", lifecycle: paused, health, nowMs, ...props,
    }));
  });
  return renderer;
}

test("a paused routine previews its next runs in Coven's zone, with the coming clock change", async () => {
  const renderer = await render({});
  try {
    const shown = text(renderer.toJSON());
    assert.match(shown, /Times are in America\/Chicago, the zone Coven runs this automation in\./);
    assert.match(shown, /Paused\. Nothing runs until it's resumed\./);
    assert.equal(renderer.root.findAllByType("time").filter((node) => node.props.dateTime?.startsWith("2026-10-")).length >= 5, true);
    const runs = renderer.root.findByProps({ "aria-label": "Next 5 runs" });
    assert.equal(runs.findAllByType("li").length, 5);
    assert.equal(runs.findAllByType("time")[0].props.dateTime, "2026-10-18T14:00:00.000Z");
    assert.match(shown, /Clocks change in America\/Chicago: from .* it runs at UTC−6 instead of UTC−5\./);
    assert.match(shown, /Coven's next scheduled slot: .*\. It runs only once the automation is active\./);
    // The form's BYMINUTE=0 rebuild is the saved rule, not an unsaved change.
    assert.doesNotMatch(shown, /unsaved/);
    assert.doesNotMatch(shown, /differs/);
  } finally { await act(async () => renderer.unmount()); }
});

test("an edited rule is labelled as unsaved and does not contradict Coven's slot", async () => {
  const renderer = await render({ rrule: "RRULE:FREQ=DAILY;BYHOUR=10;BYMINUTE=0" });
  try {
    const shown = text(renderer.toJSON());
    assert.match(shown, /Previewing unsaved changes\. Coven runs the saved schedule until you save\./);
    assert.doesNotMatch(shown, /differs/);
  } finally { await act(async () => renderer.unmount()); }
});

test("a disagreement with Coven's own next slot is said out loud, and Coven's slot wins", async () => {
  const renderer = await render({ lifecycle: { ...paused, state: "active" }, health: { ...health, nextDueAt: "2026-10-18T15:00:00.000Z" } });
  try {
    assert.match(text(renderer.toJSON()), /Cave's preview differs from it; Coven's slot is the one that counts\./);
  } finally { await act(async () => renderer.unmount()); }
});

test("without a verified zone the viewer's zone is used and labelled as such", async () => {
  const renderer = await render({ lifecycle: { state: "unknown", revision: null, timezone: null, freshness: "unavailable", readAt: null }, health: null });
  try {
    const shown = text(renderer.toJSON());
    assert.match(shown, /Coven's time zone for this automation isn't verified, so times are shown in your time zone/);
    assert.match(shown, /Coven's next scheduled slot couldn't be read\./);
  } finally { await act(async () => renderer.unmount()); }
});

test("a rule Coven does not run is not previewed", async () => {
  const renderer = await render({ rrule: "RRULE:FREQ=HOURLY", health: undefined });
  try {
    const shown = text(renderer.toJSON());
    assert.match(shown, /Cave can't preview this rule\./);
    assert.match(shown, /Reading Coven's next scheduled slot/);
  } finally { await act(async () => renderer.unmount()); }
});
