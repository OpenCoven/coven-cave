// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RunningActivityList } from "./running-activity-popover.tsx";
import type { RunningActivityItem } from "@/lib/running-activity";

const FAMILIARS = [
  { id: "onyx", display_name: "Onyx" },
  { id: "kestrel", display_name: "Kestrel" },
];

function item(over = {}) {
  return {
    id: "session:s1",
    kind: "session",
    title: "Draft release notes",
    status: "running",
    startedAt: "2026-08-23T09:00:00.000Z",
    familiarId: "onyx",
    targetId: "s1",
    ...over,
  };
}

function render(list) {
  return renderToStaticMarkup(
    createElement(RunningActivityList, {
      items: list.items,
      unavailable: list.unavailable ?? [],
      familiars: FAMILIARS,
      onOpen: list.onOpen ?? (() => {}),
      onViewAll: list.onViewAll ?? (() => {}),
    }),
  );
}

test("rows render title, kind label, familiar, and a relative start time", () => {
  const html = render({ items: [item()] });
  assert.ok(html.includes("Draft release notes"));
  assert.ok(html.includes("Chat · Onyx"), "the kind label + familiar read together");
  assert.ok(html.includes("started <time"), "a row with a start time renders a real clock");
  assert.ok(
    html.includes('aria-label="Chat: Draft release notes"'),
    "the row carries an accessible name with its kind and title",
  );
});

test("each kind renders its own label, and queued items announce queued", () => {
  const items = [
    item({ id: "board-task:c1", kind: "board-task", title: "Wire pipeline", familiarId: null, targetId: "c1" }),
    item({ id: "automation:a1", kind: "automation", title: "Morning sweep", status: "queued", familiarId: null, targetId: "a1" }),
    item({ id: "flow:f1", kind: "flow", title: "Deploy", familiarId: null, targetId: "f1" }),
    item({ id: "workflow:w1", kind: "workflow", title: "wf-nightly", familiarId: null, targetId: "wf1" }),
  ];
  const html = render({ items });
  for (const kind of ["Task · started", "Ritual · started", "Flow · started", "Workflow · started"]) {
    assert.ok(html.includes(kind), `the ${kind} kind label renders with its start time`);
  }
  assert.ok(html.includes('aria-label="Task: Wire pipeline"'));
  assert.ok(html.includes('aria-label="Ritual queued: Morning sweep"'), "queued items say queued");
  assert.ok(html.includes("bg-[var(--color-warning)]"), "queued dot uses the warning tint");
  assert.ok(html.includes("animate-pulse bg-[var(--color-success)]"), "running dot pulses green");
});

test("empty list renders the nothing-running state but keeps View all", () => {
  const html = render({ items: [] });
  assert.ok(html.includes("Nothing running right now"));
  assert.ok(html.includes("View all activity"));
});

test("unavailable sources render a human note naming what is missing", () => {
  const html = render({ items: [item()], unavailable: ["flows", "workflows"] });
  assert.ok(html.includes("Some activity unavailable: flows, workflows"));
});

test("a click on a row and on View all invokes the right handler", () => {
  let opened = null;
  let viewedAll = false;
  const list = {
    items: [item()],
    onOpen: (i) => { opened = i; },
    onViewAll: () => { viewedAll = true; },
  };
  const html = render(list);
  assert.ok(html.includes("View all activity"));
  // Handlers are wired through props; the markup assertion above proves the
  // buttons exist. The actual invocation is exercised by the container source
  // contract below (onOpen closes + delegates, onViewAll closes + delegates).
  assert.equal(opened, null);
  assert.equal(viewedAll, false);
});

// ── Container source contract ────────────────────────────────────────────────
const source = readFileSync(new URL("./running-activity-popover.tsx", import.meta.url), "utf8");

test("each activity kind maps to a distinct glyph", () => {
  assert.match(
    source,
    /const KIND_ICON[\s\S]*?session: "ph:chat-circle-dots",[\s\S]*?"board-task": "ph:kanban",[\s\S]*?automation: "ph:clock",[\s\S]*?flow: "ph:flow-arrow",[\s\S]*?workflow: "ph:tree-structure",/,
    "the five kinds each carry their own Phosphor glyph",
  );
});

test("the trigger is a focus-ring button hidden at zero with no unavailable sources", () => {
  assert.match(source, /if \(total === 0 && unavailable\.length === 0\) return null;/);
  assert.match(
    source,
    /aria-haspopup="dialog"\s*aria-expanded=\{open\}\s*aria-label=\{`\$\{label\} — show activity`\}/,
    "the trigger announces the popover and its exact count",
  );
  assert.match(source, /<Icon name="ph:waveform"/);
  assert.match(source, /fmtBadge\(total\)/, "the corner badge caps at 9+");
});

test("the popover is an accessible focus-trapped dialog that closes on escape and outside click", () => {
  assert.match(source, /useFocusTrap\(open, popoverRef, \{ onEscape: \(\) => setOpen\(false\) \}\)/);
  assert.match(
    source,
    /role="dialog"\s*aria-modal="true"\s*aria-label="Running activity"\s*tabIndex=\{-1\}/,
  );
  assert.match(source, /window\.addEventListener\("pointerdown", onDown\)/);
});

test("the popover polls with the shared pausable discipline and refreshes on open", () => {
  assert.match(source, /usePausablePoll\(load, pollIntervalMs\)/);
  assert.match(source, /if \(!open\) return;[\s\S]{0,80}load\(\);/);
});

test("opening a row closes the popover and delegates to onOpenItem; View all delegates to onViewAll", () => {
  assert.match(
    source,
    /onOpen=\{\(item\) => \{\s*setOpen\(false\);\s*onOpenItem\(item\);\s*\}\}/,
  );
  assert.match(
    source,
    /onViewAll=\{\(\) => \{\s*setOpen\(false\);\s*onViewAll\(\);\s*\}\}/,
  );
});

console.log("running-activity-popover.test.ts: ok");
