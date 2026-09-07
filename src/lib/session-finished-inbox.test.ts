import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasUnresolvedSessionFinishedItem,
  isSessionFinishedItem,
  SESSION_FINISHED_AUTO,
  SESSION_FINISHED_NOTIFY_MIN_MS,
  sessionFinishedItem,
  shouldNotifySessionFinished,
} from "./session-finished-inbox.ts";
import type { InboxItem } from "./cave-inbox.ts";

const base: InboxItem = {
  id: "i1",
  kind: "agent",
  title: "x",
  status: "fired",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  fireAt: null,
  firedAt: "2026-01-01T00:00:00.000Z",
  snoozeUntil: null,
  recurrence: { type: "none" },
  source: "agent",
  familiarId: "fam-a",
  sessionId: "s-1",
  link: { kind: "session", ref: "s-1" },
  media: null,
  auto: null,
  readAt: null,
  muted: null,
};

describe("sessionFinishedItem", () => {
  it("builds the exact <familiar> finished: <session title> agent item", () => {
    const input = sessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionTitle: "Fix the search bar",
      sessionId: "s-1",
    });
    assert.equal(input.kind, "agent");
    assert.equal(input.title, "Nyx finished: Fix the search bar");
    assert.equal(input.source, "agent");
    assert.equal(input.familiarId, "fam-a");
    assert.equal(input.sessionId, "s-1");
    assert.deepEqual(input.link, { kind: "session", ref: "s-1" });
    assert.equal(input.auto, SESSION_FINISHED_AUTO);
  });
});

describe("shouldNotifySessionFinished", () => {
  it("stays silent when the user is watching and the turn was short", () => {
    assert.equal(
      shouldNotifySessionFinished({ watchedByUser: true, durationMs: 30_000 }),
      false,
    );
  });
  it("notifies when the user is not watching, even for a short turn", () => {
    assert.equal(
      shouldNotifySessionFinished({ watchedByUser: false, durationMs: 30_000 }),
      true,
    );
  });
  it("notifies long turns even when the user is watching", () => {
    assert.equal(
      shouldNotifySessionFinished({
        watchedByUser: true,
        durationMs: SESSION_FINISHED_NOTIFY_MIN_MS + 1,
      }),
      true,
    );
  });
  it("notifies when the user is not watching and the turn was long", () => {
    assert.equal(
      shouldNotifySessionFinished({
        watchedByUser: false,
        durationMs: SESSION_FINISHED_NOTIFY_MIN_MS + 1,
      }),
      true,
    );
  });
  it("treats an unknown duration as watched-only", () => {
    assert.equal(shouldNotifySessionFinished({ watchedByUser: true, durationMs: null }), false);
    assert.equal(shouldNotifySessionFinished({ watchedByUser: false, durationMs: null }), true);
    assert.equal(shouldNotifySessionFinished({ watchedByUser: true, durationMs: undefined }), false);
  });
});

describe("isSessionFinishedItem / hasUnresolvedSessionFinishedItem", () => {
  it("recognizes items by the auto discriminator and session id", () => {
    const mine: InboxItem = { ...base, auto: SESSION_FINISHED_AUTO } as InboxItem;
    assert.equal(isSessionFinishedItem(mine, "s-1"), true);
    assert.equal(isSessionFinishedItem(mine, "s-2"), false);
    assert.equal(isSessionFinishedItem(mine), true);
    const other: InboxItem = { ...base, auto: "archive-nudge" } as InboxItem;
    assert.equal(isSessionFinishedItem(other, "s-1"), false);
  });
  it("matches on the session link ref when sessionId differs", () => {
    const linked: InboxItem = {
      ...base,
      sessionId: null,
      link: { kind: "session", ref: "s-9" },
      auto: SESSION_FINISHED_AUTO,
    } as InboxItem;
    assert.equal(isSessionFinishedItem(linked, "s-9"), true);
  });
  it("an unresolved item dedups its session; resolved ones do not", () => {
    const fired: InboxItem = { ...base, status: "fired", auto: SESSION_FINISHED_AUTO } as InboxItem;
    assert.equal(hasUnresolvedSessionFinishedItem([fired], "s-1"), true);
    const pending: InboxItem = { ...base, status: "pending", auto: SESSION_FINISHED_AUTO } as InboxItem;
    assert.equal(hasUnresolvedSessionFinishedItem([pending], "s-1"), true);
    const done: InboxItem = { ...base, status: "done", auto: SESSION_FINISHED_AUTO } as InboxItem;
    assert.equal(hasUnresolvedSessionFinishedItem([done], "s-1"), false);
    const dismissed: InboxItem = { ...base, status: "dismissed", auto: SESSION_FINISHED_AUTO } as InboxItem;
    assert.equal(hasUnresolvedSessionFinishedItem([dismissed], "s-1"), false);
    assert.equal(hasUnresolvedSessionFinishedItem([], "s-1"), false);
  });
});
