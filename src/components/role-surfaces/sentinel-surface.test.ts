import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  filterAlerts,
  isOpenAlert,
  summarizeAlerts,
  watchSessions,
  watchtowerStatus,
} from "./sentinel-watch.ts";
import type { Escalation } from "@/lib/escalations-types";
import type { SessionRow } from "@/lib/types";

const surface = readFileSync(new URL("./sentinel-surface.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("./register.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../../docs/role-surfaces.md", import.meta.url), "utf8");

// ── Alert semantics (behavioral, real module) ────────────────────────────────

const NOW = Date.parse("2026-07-14T12:00:00Z");

/** Minimal escalation factory — only the fields the watch logic reads. */
function alert(overrides: Partial<Escalation> = {}): Escalation {
  return {
    id: "esc-1",
    createdAt: "2026-07-14T10:00:00Z",
    updatedAt: "2026-07-14T10:00:00Z",
    origin: "heartbeat",
    title: "Daemon heartbeat missed",
    severity: "warn",
    state: "new",
    decisionRequired: false,
    ...overrides,
  };
}

test("isOpenAlert mirrors the Inbox badge rule", () => {
  assert.equal(isOpenAlert(alert(), NOW), true);
  assert.equal(isOpenAlert(alert({ state: "acknowledged" }), NOW), true);
  assert.equal(isOpenAlert(alert({ state: "resolved" }), NOW), false);
  assert.equal(isOpenAlert(alert({ state: "dismissed" }), NOW), false);
  // Snoozed with a future wake time is quiet; a due (or missing) wake time is open.
  assert.equal(isOpenAlert(alert({ state: "snoozed", snoozeUntil: "2026-07-14T18:00:00Z" }), NOW), false);
  assert.equal(isOpenAlert(alert({ state: "snoozed", snoozeUntil: "2026-07-14T09:00:00Z" }), NOW), true);
  assert.equal(isOpenAlert(alert({ state: "snoozed" }), NOW), true);
});

test("summarizeAlerts counts open severities, quiet snoozes, and required decisions", () => {
  const items = [
    alert({ id: "a", severity: "critical", decisionRequired: true }),
    alert({ id: "b", severity: "warn" }),
    alert({ id: "c", severity: "info", state: "acknowledged" }),
    alert({ id: "d", severity: "critical", state: "resolved", decisionRequired: true }),
    alert({ id: "e", state: "snoozed", snoozeUntil: "2026-07-14T18:00:00Z" }),
  ];
  const summary = summarizeAlerts(items, NOW);
  assert.deepEqual(summary, {
    open: 3,
    critical: 1,
    warn: 1,
    info: 1,
    snoozed: 1,
    decisionsRequired: 1,
  });
});

test("filterAlerts scopes without re-sorting the API's order", () => {
  const items = [
    alert({ id: "crit", severity: "critical" }),
    alert({ id: "warn", severity: "warn" }),
    alert({ id: "quiet", state: "snoozed", snoozeUntil: "2026-07-14T18:00:00Z" }),
    alert({ id: "closed", state: "resolved" }),
  ];
  assert.deepEqual(filterAlerts(items, "open", "all", NOW).map((i) => i.id), ["crit", "warn"]);
  assert.deepEqual(filterAlerts(items, "snoozed", "all", NOW).map((i) => i.id), ["quiet"]);
  assert.deepEqual(filterAlerts(items, "resolved", "all", NOW).map((i) => i.id), ["closed"]);
  assert.deepEqual(filterAlerts(items, "all", "critical", NOW).map((i) => i.id), ["crit"]);
  assert.equal(filterAlerts(items, "open", "info", NOW).length, 0);
});

// ── Session watch (behavioral, real module) ──────────────────────────────────

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s-1",
    project_root: "/tmp/p",
    harness: "codex",
    title: "run",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-07-14T09:00:00Z",
    updated_at: "2026-07-14T09:30:00Z",
    ...overrides,
  };
}

test("watchSessions counts running sessions and surfaces unarchived failures newest-first", () => {
  const sessions = [
    session({ id: "run-1", status: "running", exit_code: null }),
    session({ id: "ok" }),
    session({ id: "old-fail", exit_code: 1, updated_at: "2026-07-14T08:00:00Z" }),
    session({ id: "new-fail", exit_code: 2, updated_at: "2026-07-14T11:00:00Z" }),
    session({ id: "archived-fail", exit_code: 1, archived_at: "2026-07-14T10:00:00Z" }),
  ];
  const watch = watchSessions(sessions);
  assert.equal(watch.running, 1);
  assert.equal(watch.failed, 2);
  assert.deepEqual(watch.recentFailures.map((s) => s.id), ["new-fail", "old-fail"]);
});

test("watchSessions caps the failure watch log", () => {
  const failures = Array.from({ length: 9 }, (_, i) =>
    session({ id: `f-${i}`, exit_code: 1, updated_at: `2026-07-14T0${i}:00:00Z` }),
  );
  assert.equal(watchSessions(failures).recentFailures.length, 6);
});

test("watchtowerStatus escalates tone with the sweep", () => {
  assert.deepEqual(watchtowerStatus({ open: 0, critical: 0 }), { label: "perimeter clear", tone: "ok" });
  assert.deepEqual(watchtowerStatus({ open: 2, critical: 0 }), { label: "2 open alerts", tone: "busy" });
  assert.deepEqual(watchtowerStatus({ open: 3, critical: 1 }), { label: "1 critical alert", tone: "warn" });
});

// ── Surface wiring (source pins) ─────────────────────────────────────────────

test("surface triages the real escalation store, never a pretend one", () => {
  assert.match(surface, /fetch\("\/api\/escalations"/);
  assert.match(surface, /\/api\/escalations\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(surface, /method: "PATCH"/);
  assert.match(surface, /Acknowledge/);
  assert.match(surface, /Resolve/);
  assert.match(surface, /Dismiss/);
  assert.match(surface, /SNOOZE_PRESETS\.map/);
});

test("surface watches real perimeter and session state", () => {
  assert.match(surface, /fetch\("\/api\/hosts"/);
  assert.match(surface, /watchSessions\(context\.runtimeState\.sessions\)/);
  assert.match(surface, /context\.openSession\(/);
  assert.match(surface, /context\.openUrl\(/);
  assert.match(surface, /SurfaceEmpty/);
  assert.match(surface, /useRoleSurfaceState<SentinelState>/);
});

test("surface exposes errors and selection state accessibly", () => {
  assert.match(surface, /role="alert"/);
  assert.match(surface, /aria-current=\{item\.id === state\.selectedId/);
  assert.match(surface, /aria-pressed=\{state\.severity === severity\}/);
});

test("registration names the Watchtower with its own accent and drawer chrome", () => {
  assert.match(register, /id: SENTINEL_SURFACE_ID/);
  assert.match(register, /role: "sentinel"/);
  assert.match(register, /title: "Watchtower"/);
  assert.match(register, /iconName: "ph:binoculars"/);
  assert.match(register, /accentHue: 40/);
  assert.match(register, /combo: "mod\+shift\+d",\s*\n\s*description: "Toggle the watch log drawer"/);
  assert.match(register, /watchtowerStatus\(/);
});

test("the Watchtower is documented as an initial room", () => {
  assert.match(docs, /\*\*Watchtower\*\* \(`sentinel-watchtower`, role `sentinel`\)/);
});
