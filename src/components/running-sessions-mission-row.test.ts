// Behavioural test for the running-processes popover: it renders the list and
// asserts on the MARKUP the human actually sees, not on the component source.
//
// The surface under test is the app's one globally-visible, ambient readout of
// what is running — no toast, no sound, no unread badge — which is why an
// in-flight `/auto` mission is reported here rather than through /api/inbox.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { RunningSessionList } from "./running-sessions-popover.tsx";
import { autoMissionKey, type AutoMissionRecord } from "@/lib/auto-mission-state";
import { NO_CHAT_ATTENTION } from "@/lib/chat-attention";
import type { Familiar, SessionRow } from "@/lib/types";

const STARTED = "2026-08-23T09:55:00.000Z";

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-a",
    project_root: "/repo/alpha",
    harness: "claude",
    // An /auto chat's title is derived from the generated directive — this is
    // the string the row shows today.
    title: "Run this as an autonomous /auto mission: rewrite the token tests",
    status: "running",
    exit_code: null,
    archived_at: null,
    created_at: STARTED,
    updated_at: STARTED,
    attention: NO_CHAT_ATTENTION,
    familiarId: "onyx",
    ...over,
  };
}

const familiars: Familiar[] = [
  { id: "onyx", display_name: "Onyx" } as unknown as Familiar,
];

function record(over: Partial<AutoMissionRecord> = {}): AutoMissionRecord {
  return {
    mission: "rewrite the token tests and get CI green",
    startedAt: STARTED,
    notified: [],
    completedAt: null,
    outcome: null,
    lastActivityAt: 0,
    feedbackPending: false,
    ...over,
  };
}

type Storage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

function storageWith(entries: Record<string, AutoMissionRecord>): Storage {
  const map = new Map<string, string>();
  for (const [sessionId, value] of Object.entries(entries)) {
    map.set(autoMissionKey(sessionId), JSON.stringify(value));
  }
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function render(sessions: SessionRow[], storage: Storage | null) {
  return renderToStaticMarkup(
    createElement(RunningSessionList, {
      sessions,
      familiars,
      onOpen: () => {},
      missionStorage: storage,
    }),
  );
}

test("a running session with an armed mission renders the mission text, not the directive title", () => {
  const html = render([session()], storageWith({ "sess-a": record() }));
  assert.ok(
    html.includes("rewrite the token tests and get CI green"),
    "the row names the mission the human typed",
  );
  assert.ok(
    !html.includes("Run this as an autonomous"),
    "the generated directive must not leak into the menu bar",
  );
});

test("a mission row is marked as a mission and described as in progress", () => {
  const html = render([session()], storageWith({ "sess-a": record() }));
  assert.ok(html.includes(">Mission<"), "the row carries a visible Mission tag");
  assert.ok(
    html.includes("Auto mission in progress — rewrite the token tests and get CI green"),
    "the accessible name says it is running",
  );
  assert.ok(html.includes('data-auto-mission="true"'), "the row is identifiable as a mission row");
});

test("a mission row reports when the MISSION started, not when the session was created", () => {
  const html = render(
    [session({ created_at: "2026-08-23T08:00:00.000Z" })],
    storageWith({ "sess-a": record({ startedAt: "2026-08-23T09:55:00.000Z" }) }),
  );
  // React emits the JSX prop name verbatim (`dateTime=`); HTML attribute names
  // are case-insensitive, so match on the lowercased markup.
  const lower = html.toLowerCase();
  assert.ok(
    lower.includes('datetime="2026-08-23t09:55:00.000z"'),
    "the elapsed clock runs from the mission, which can start long after the chat",
  );
  assert.ok(!lower.includes('datetime="2026-08-23t08:00:00.000z"'));
});

test("an ordinary running chat is untouched — no tag, no mission wording, its own title", () => {
  const html = render(
    [session({ id: "plain", title: "Draft the release notes" })],
    storageWith({}),
  );
  assert.ok(html.includes("Draft the release notes"));
  assert.ok(!html.includes(">Mission<"), "no mission tag on an ordinary chat");
  assert.ok(!html.includes("Auto mission in progress"));
  assert.ok(!html.includes("data-auto-mission"));
  assert.ok(html.includes("Open this chat — Draft the release notes"));
});

// The three tests below supersede the source-regex assertion that used to live
// in running-sessions-popover.test.ts:
//
//   assert.match(source, /started <RelativeTime iso=\{session\.created_at\} fallback="—" \/>/)
//
// That regex pinned the literal expression, which legitimately changed when a
// mission row started reporting the MISSION's clock. It could never have
// distinguished the two row kinds anyway — it only saw that the characters
// "session.created_at" appeared somewhere in the file — and it would have
// passed just as happily if the row had stopped rendering altogether. These
// assert the rendered output instead, per row kind, including the fallback.

test("an ordinary row reports the session's OWN start time", () => {
  const html = render(
    [session({ id: "plain", title: "Draft the release notes", created_at: "2026-08-23T08:00:00.000Z" })],
    storageWith({}),
  );
  const lower = html.toLowerCase();
  assert.ok(
    lower.includes('datetime="2026-08-23t08:00:00.000z"'),
    "an ordinary process is timed from when the session was created",
  );
  assert.ok(html.includes("started <time"), "and it renders a real timestamp, not the fallback");
});

test("a row with no usable timestamp renders the em-dash fallback, not a broken clock", () => {
  for (const created of [null, "not-a-date"]) {
    const html = render(
      [session({ id: "plain", title: "Draft the release notes", created_at: created as string })],
      storageWith({}),
    );
    assert.ok(
      html.includes("started <span>—</span>"),
      `an unusable created_at (${String(created)}) falls back to the em dash`,
    );
    assert.ok(!html.includes("<time"), "and emits no <time> element at all");
  }
});

test("a mission row with an unusable mission start falls back — it never borrows the session's clock", () => {
  // The session has a perfectly good created_at. A mission row must still not
  // report it: that would silently misattribute the chat's age to the mission.
  const html = render(
    [session({ created_at: "2026-08-23T08:00:00.000Z" })],
    storageWith({ "sess-a": record({ startedAt: "not-a-date" }) }),
  );
  assert.ok(html.includes(">Mission<"), "still a mission row");
  assert.ok(html.includes("started <span>—</span>"), "an unusable mission start falls back");
  assert.ok(
    !html.toLowerCase().includes('datetime="2026-08-23t08:00:00.000z"'),
    "and the session's own created_at is never substituted in",
  );
});

test("a session whose mission already finished renders as an ordinary chat", () => {
  // The record is still in storage — nothing outside the chat clears it. The
  // row must fall back rather than claim finished work is in flight.
  const html = render(
    [session({ title: "Nightly sweep" })],
    storageWith({ "sess-a": record({ completedAt: "2026-08-23T10:20:00.000Z", outcome: "done" }) }),
  );
  assert.ok(html.includes("Nightly sweep"));
  assert.ok(!html.includes(">Mission<"));
  assert.ok(!html.includes("Auto mission in progress"));
});

test("mission and ordinary rows render side by side, each labelled correctly", () => {
  const html = render(
    [session(), session({ id: "plain", title: "Draft the release notes" })],
    storageWith({ "sess-a": record() }),
  );
  assert.equal(html.match(/>Mission</g)?.length, 1, "exactly one row is tagged");
  assert.ok(html.includes("rewrite the token tests and get CI green"));
  assert.ok(html.includes("Draft the release notes"));
});

test("the list still renders when mission storage is unavailable", () => {
  const html = render([session({ title: "Draft the release notes" })], null);
  assert.ok(html.includes("Draft the release notes"));
  assert.ok(!html.includes(">Mission<"));
});
