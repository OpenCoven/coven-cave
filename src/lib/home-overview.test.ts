import assert from "node:assert/strict";
import { homeOverviewConnection, homeOverviewFreshness, homeOverviewRows, homeOverviewSessionState, type HomeOverviewObservation } from "./home-overview.ts";
import type { SessionRow } from "./types.ts";

const checkedAt = "2026-11-04T10:00:00.000Z";
const now = Date.parse(checkedAt);
assert.deepEqual(homeOverviewConnection({ kind: "unavailable", reason: "PRIVATE_DIAGNOSTIC_SENTINEL" }, checkedAt), { result: { kind: "unavailable" }, checkedAt }, "raw diagnostic text is excluded before Home retains an observation");
const observation: HomeOverviewObservation = { loaded: true, error: false, complete: true, scopeFamiliarId: "nova", checkedAt };
function row(id: string, changes: Partial<SessionRow> = {}): SessionRow {
  return { id, familiarId: "nova", project_root: "/repo", harness: "codex", title: id, status: "completed", exit_code: 0, archived_at: null, created_at: checkedAt, updated_at: checkedAt, attention: { state: "none", since: null, reason: null } as SessionRow["attention"], ...changes };
}
function project(sessions: SessionRow[], changes: Partial<Parameters<typeof homeOverviewRows>[0]> = {}) {
  return homeOverviewRows({ sessions, observation, dataScopeFamiliarId: "nova", scopeFamiliarId: "nova", familiarIds: ["nova"], projectRoot: "/repo", ...changes });
}

assert.equal(homeOverviewFreshness(observation, "nova", now), "current");
assert.equal(homeOverviewFreshness({ ...observation, complete: false }, "nova", now), "partial");
assert.equal(homeOverviewFreshness({ ...observation, error: true }, "nova", now), "stale");
assert.equal(homeOverviewFreshness({ ...observation, error: true, checkedAt: null }, "nova", now), "unavailable");
assert.equal(homeOverviewFreshness(observation, "echo", now), "loading");
assert.equal(homeOverviewFreshness(observation, "nova", now + 60_000), "stale");
assert.equal(homeOverviewFreshness(observation, "nova", now - 60_001), "stale", "clock changes do not manufacture freshness");
assert.equal(homeOverviewFreshness({ ...observation, checkedAt: "bad" }, "nova", now), "unavailable");

const blocked = row("approval", { attention: { state: "awaiting-human", since: checkedAt, reason: "approval" } as SessionRow["attention"] });
const rows = project([
  blocked,
  row("running", { status: "running" }),
  row("queued", { status: "queued" }),
  row("future", { status: "unknown-new-producer-state" }),
  row("done"),
  row("archived", { archived_at: checkedAt }),
  row("generated", { generated: true }),
  row("same-display-name-other-id", { familiarId: "echo", status: "failed" }),
  { ...blocked, id: "other-project", project_root: "/other" },
]);
assert.deepEqual(rows.attention.map((r) => r.id), ["approval"]);
assert.deepEqual(rows.elsewhere.map((r) => r.id), ["other-project"], "project filters do not suppress authorized attention elsewhere");
assert.deepEqual(rows.running.map((r) => r.id), ["queued", "running"]);
assert.deepEqual(rows.outcomes.map((r) => r.id), ["done", "future"]);
assert.equal(homeOverviewSessionState(row("future", { status: "success-ish" })).label, "State unavailable");
assert.equal(homeOverviewSessionState(row("queued", { status: "queued" })).label, "Queued");
assert.equal(homeOverviewSessionState(blocked).label, "Blocked");
const unknownWithAsk = { ...blocked, id: "future-with-ask", status: "future-status" };
assert.deepEqual(project([unknownWithAsk]).attention.map((r) => r.id), ["future-with-ask"], "unknown execution state must not suppress canonical attention");
assert.equal(homeOverviewSessionState(unknownWithAsk).label, "Blocked · execution state unavailable");
assert.equal(homeOverviewSessionState(row("done")).label, "Completed", "completion is not relabeled as committed");

assert.deepEqual(project([blocked], { scopeFamiliarId: "echo" }).attention, [], "previous familiar rows never paint in a new scope");
assert.deepEqual(project([blocked], { dataScopeFamiliarId: "echo" }).attention, [], "a new-scope read cannot relabel old cached rows");
assert.deepEqual(project([blocked], { observation: { ...observation, accessDenied: true } }).attention, [], "refused access never retains old row metadata in the view");
assert.deepEqual(project([blocked], { observation: { ...observation, loaded: false, checkedAt: null } }).attention, [], "a cached scope is not painted before its read is established");
assert.equal(project([row("unbound", { familiarId: null })]).unbound, 1, "missing bindings remain explicit");
assert.deepEqual(project([row("unbound", { familiarId: null })]).outcomes, [], "selected familiar never adopts an unbound row");
assert.deepEqual(project([row("exact", { project_root: "/repo/" })]).outcomes.map((r) => r.id), ["exact"]);
assert.deepEqual(project([row("remote", { runtime: "ssh:vm-1:/repo" })]).outcomes, [], "same root on a remote host is not the selected local project");
assert.deepEqual(project([row("missing-root", { project_root: "" })], { projectRoot: "/" }).outcomes, [], "missing roots are not inferred to be filesystem root");
console.log("home-overview: scope, canonical attention, unknown state and observation freshness checks passed");
