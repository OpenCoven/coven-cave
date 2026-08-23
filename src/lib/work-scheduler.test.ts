// Behavioral tests for the Work scheduler model (cave-7c329).
//
// These deliberately assert PROPERTIES, not spellings. The frame this surface
// comes from draws several figures the Cave cannot back, so each test below
// pins the honesty decision that replaced one:
//
//   - a reorder survives a reload (because the only ordering write is a stored
//     priority band, and the order is a pure function of the tracker);
//   - a lane figure equals a value derived from the same rows the table shows,
//     and is not a placeholder;
//   - a lane reports no state at all when the roster was not read;
//   - a gate card names a real unresolved dependency and states why one of
//     them is primary, because beads do not designate one;
//   - an undo that is offered actually reverses the action when fired.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRIORITY_BANDS,
  REASSIGN_IRREVERSIBLE,
  SCHEDULER_LOG_LIMIT,
  SCHEDULER_STALE_FACTOR,
  UNASSIGNED_LANE_KEY,
  appendSchedulerLog,
  beadOwnerKey,
  buildGateCards,
  buildSchedulerLanes,
  buildSchedulerQueue,
  deriveSchedulerStatus,
  gatePrimaryBasisText,
  markSchedulerLogUndone,
  priorityBand,
  priorityLogEntry,
  reassignLogEntry,
  schedulerLogEntryIsCoherent,
  undoRequestBody,
  type BlockedBead,
  type SchedulerBead,
  type SchedulerLogEntry,
} from "@/lib/work-scheduler.ts";
import type { Familiar, SessionRow } from "@/lib/types.ts";

// ── fixtures ─────────────────────────────────────────────────────────────────

const familiar = (id: string, over: Partial<Familiar> = {}): Familiar =>
  ({ id, display_name: id[0].toUpperCase() + id.slice(1), role: "coding", status: "online", ...over }) as Familiar;

const NOVA = familiar("nova");
const ORION = familiar("orion");
const FAMILIARS = [NOVA, ORION];

const bead = (over: Partial<SchedulerBead> & { id: string }): SchedulerBead => ({
  title: `Task ${over.id}`,
  priority: 2,
  status: "open",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

const session = (over: Partial<SessionRow> & { id: string }): SessionRow =>
  ({
    project_root: "/repo",
    harness: "claude",
    title: `Session ${over.id}`,
    status: "running",
    exit_code: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    ...over,
  }) as SessionRow;

// ── the queue order is a pure function of the tracker ────────────────────────

test("queue order is derived from the beads alone, so identical input always renders identically", () => {
  const beads = [
    bead({ id: "cave-c", priority: 2, updated_at: "2026-08-03T00:00:00.000Z" }),
    bead({ id: "cave-a", priority: 0 }),
    bead({ id: "cave-b", priority: 2, updated_at: "2026-08-01T00:00:00.000Z" }),
  ];

  const first = buildSchedulerQueue(beads, { familiars: FAMILIARS });
  // Reversing the INPUT array must not change the OUTPUT: nothing about the
  // caller's ordering, or about any earlier call, may leak into the result.
  const second = buildSchedulerQueue([...beads].reverse(), { familiars: FAMILIARS });

  assert.deepEqual(
    first.map((row) => row.bead.id),
    ["cave-a", "cave-b", "cave-c"],
    "priority band first, then oldest update",
  );
  assert.deepEqual(first.map((r) => r.bead.id), second.map((r) => r.bead.id));
  assert.deepEqual(first.map((r) => r.position), [1, 2, 3]);
});

test("a reorder survives a reload: the ONLY way to move a row is a priority band the tracker stores", () => {
  // The user moves cave-c to the top. There is no reorder API to call — the
  // surface writes `bd update --priority`, so the move is a change to the
  // bead. Simulate the round trip: mutate the tracker, refetch, rebuild.
  const before = [bead({ id: "cave-a", priority: 0 }), bead({ id: "cave-c", priority: 3 })];
  assert.deepEqual(
    buildSchedulerQueue(before, { familiars: FAMILIARS }).map((r) => r.bead.id),
    ["cave-a", "cave-c"],
  );

  const entry = priorityLogEntry({
    id: "log-1",
    at: 0,
    beadId: "cave-c",
    beadTitle: "Task cave-c",
    previousPriority: 3,
    priority: 0,
  });
  assert.equal(entry.undo?.priority, 3, "the entry records the value needed to reverse it");

  // What the tracker looks like on the next poll, after that write landed.
  const afterReload = [bead({ id: "cave-a", priority: 0 }), bead({ id: "cave-c", priority: 0 })];
  assert.deepEqual(
    buildSchedulerQueue(afterReload, { familiars: FAMILIARS }).map((r) => r.bead.id),
    ["cave-a", "cave-c"],
    "same band, so the tie-break decides — and it is reproducible",
  );

  const promoted = [bead({ id: "cave-a", priority: 1 }), bead({ id: "cave-c", priority: 0 })];
  assert.deepEqual(
    buildSchedulerQueue(promoted, { familiars: FAMILIARS }).map((r) => r.bead.id),
    ["cave-c", "cave-a"],
    "a stored band change reorders the queue on the very next read",
  );
});

test("priority bands are bd's five integer bands, not a four-band invention", () => {
  assert.deepEqual(PRIORITY_BANDS.map((band) => band.value), [0, 1, 2, 3, 4]);
  assert.equal(priorityBand(0).label, "Critical");
  assert.equal(priorityBand(4).label, "Backlog");
  assert.equal(priorityBand(7).label, "Unranked", "an unknown band is named unknown, not defaulted");
  assert.equal(priorityBand(null).label, "Unranked");
});

test("a bead assigned to a non-familiar keeps that name instead of reading as unowned", () => {
  const rows = buildSchedulerQueue(
    [
      bead({ id: "cave-1", assignee: "nova" }),
      bead({ id: "cave-2", assignee: "Timothy Wayne Gregg" }),
      bead({ id: "cave-3" }),
      bead({ id: "cave-4", labels: ["familiar:orion"], assignee: "someone-else" }),
    ],
    { familiars: FAMILIARS },
  );
  const byId = new Map(rows.map((row) => [row.bead.id, row]));
  assert.equal(byId.get("cave-1")?.familiarId, "nova");
  assert.equal(byId.get("cave-2")?.familiarId, null);
  assert.equal(byId.get("cave-2")?.familiarLabel, "Timothy Wayne Gregg");
  assert.equal(byId.get("cave-3")?.familiarLabel, "Unassigned");
  assert.equal(byId.get("cave-4")?.familiarId, "orion", "an explicit familiar: label wins over the assignee");
  assert.equal(beadOwnerKey(bead({ id: "x" })), null);
});

// ── lane figures come from the same rows the table shows ─────────────────────

test("every lane figure equals a value derived from the rendered rows", () => {
  const rows = buildSchedulerQueue(
    [
      bead({ id: "cave-1", assignee: "nova" }),
      bead({ id: "cave-2", assignee: "nova" }),
      bead({ id: "cave-3", assignee: "orion" }),
      bead({ id: "cave-4" }),
    ],
    { familiars: FAMILIARS },
  );
  const lanes = buildSchedulerLanes({ familiars: FAMILIARS, sessions: [], sessionsKnown: true, rows });

  const byKey = new Map(lanes.map((lane) => [lane.key, lane]));
  assert.equal(byKey.get("nova")?.queued, 2);
  assert.equal(byKey.get("orion")?.queued, 1);
  assert.equal(byKey.get(UNASSIGNED_LANE_KEY)?.queued, 1);

  assert.equal(
    lanes.reduce((sum, lane) => sum + lane.queued, 0),
    rows.length,
    "the lanes account for every row and no more",
  );
  for (const lane of lanes) {
    assert.equal(lane.shareOfQueue, lane.queued / rows.length, `${lane.key} share must be queued/total`);
  }
  assert.equal(byKey.get("nova")?.shareOfQueue, 0.5);
});

test("share-of-queue tracks the distribution rather than sitting at a placeholder", () => {
  const even = buildSchedulerLanes({
    familiars: FAMILIARS,
    sessions: [],
    sessionsKnown: true,
    rows: buildSchedulerQueue(
      [bead({ id: "a", assignee: "nova" }), bead({ id: "b", assignee: "orion" })],
      { familiars: FAMILIARS },
    ),
  });
  const lopsided = buildSchedulerLanes({
    familiars: FAMILIARS,
    sessions: [],
    sessionsKnown: true,
    rows: buildSchedulerQueue(
      [bead({ id: "a", assignee: "nova" }), bead({ id: "b", assignee: "nova" }), bead({ id: "c", assignee: "nova" })],
      { familiars: FAMILIARS },
    ),
  });
  assert.equal(even.find((l) => l.key === "nova")?.shareOfQueue, 0.5);
  assert.equal(lopsided.find((l) => l.key === "nova")?.shareOfQueue, 1);
  assert.equal(lopsided.find((l) => l.key === "orion")?.shareOfQueue, 0);
});

test("an empty queue produces zero shares, never NaN", () => {
  const lanes = buildSchedulerLanes({ familiars: FAMILIARS, sessions: [], sessionsKnown: true, rows: [] });
  assert.equal(lanes.length, 2, "no unassigned lane when nothing is unassigned");
  for (const lane of lanes) {
    assert.equal(lane.shareOfQueue, 0);
    assert.ok(Number.isFinite(lane.shareOfQueue));
  }
});

test("a lane reports NO state when the session roster was not read", () => {
  const rows = buildSchedulerQueue([bead({ id: "cave-1", assignee: "nova" })], { familiars: FAMILIARS });
  const unknown = buildSchedulerLanes({ familiars: FAMILIARS, sessions: [], sessionsKnown: false, rows });
  for (const lane of unknown) {
    assert.equal(lane.presence, null, "an unread roster must not become 'idle'");
  }
  assert.equal(unknown.find((l) => l.key === "nova")?.queued, 1, "the queue half is still real and still shown");
});

test("a lane's state and note come from that familiar's own live session", () => {
  const rows = buildSchedulerQueue([bead({ id: "cave-1", assignee: "nova" })], { familiars: FAMILIARS });
  const lanes = buildSchedulerLanes({
    familiars: FAMILIARS,
    sessions: [
      session({ id: "s1", familiarId: "nova", status: "running", title: "Wire the flux capacitor" }),
      session({ id: "s2", familiarId: "orion", status: "completed", title: "Someone else's work" }),
    ],
    sessionsKnown: true,
    rows,
  });
  const nova = lanes.find((lane) => lane.key === "nova");
  const orion = lanes.find((lane) => lane.key === "orion");
  assert.equal(nova?.presence?.state, "focused");
  assert.equal(nova?.note, "Wire the flux capacitor");
  assert.notEqual(orion?.presence?.state, "focused", "another familiar's session must not light this lane");
  assert.equal(orion?.note, null, "no running session, no note");
});

test("a lane whose familiar awaits a human reads as needing a reply, not as focused", () => {
  const lanes = buildSchedulerLanes({
    familiars: [NOVA],
    sessions: [
      session({
        id: "s1",
        familiarId: "nova",
        status: "waiting",
        attention: { state: "awaiting-human", since: null, reason: null },
      }),
    ],
    sessionsKnown: true,
    rows: [],
  });
  assert.equal(lanes[0]?.presence?.state, "blocked");
  assert.equal(lanes[0]?.presence?.label, "needs reply");
});

// ── gate cards ───────────────────────────────────────────────────────────────

const blockedBead = (over: Partial<BlockedBead> & { id: string }): BlockedBead => ({
  title: `Blocked ${over.id}`,
  priority: 2,
  status: "blocked",
  ...over,
});

test("a gate card names its unresolved dependencies from real blocker records", () => {
  const [card] = buildGateCards(
    [blockedBead({ id: "cave-top", blocked_by: ["cave-dep"] })],
    [bead({ id: "cave-dep", title: "Provision the signing key", status: "open", priority: 1 })],
  );
  assert.equal(card.blockers.length, 1);
  assert.equal(card.blockers[0].id, "cave-dep");
  assert.equal(card.blockers[0].title, "Provision the signing key", "the id is joined to a real title");
  assert.equal(card.blockers[0].status, "open");
  assert.equal(card.unnamed, 0);
  assert.equal(card.primary?.id, "cave-dep");
  assert.equal(card.primaryBasis, "sole-blocker");
  assert.equal(card.route?.beadId, "cave-dep");
  assert.match(card.route?.label ?? "", /^Open cave-dep$/, "the only action is to go to the blocker");
});

test("a blocker the join could not name is counted, not invented", () => {
  const [card] = buildGateCards([blockedBead({ id: "cave-top", blocked_by: ["cave-ghost"] })], []);
  assert.equal(card.blockers[0].title, null);
  assert.equal(card.unnamed, 1);
  assert.equal(card.primary?.id, "cave-ghost", "an unnamed blocker is still a real edge and still routable");
});

test("primary blocker is derived and says so, because beads do not designate one", () => {
  const [card] = buildGateCards(
    [blockedBead({ id: "cave-top", blocked_by: ["cave-x", "cave-y"] })],
    [
      bead({ id: "cave-x", title: "Low", priority: 3 }),
      bead({ id: "cave-y", title: "Urgent", priority: 0 }),
    ],
  );
  assert.equal(card.primary?.id, "cave-y", "highest priority among the actionable blockers");
  assert.equal(card.primaryBasis, "highest-priority-actionable");
  assert.match(gatePrimaryBasisText(card.primaryBasis!), /Beads record blockers, not a primary/);
});

test("a blocker that is itself blocked yields to one that can actually be worked", () => {
  const cards = buildGateCards(
    [
      blockedBead({ id: "cave-top", blocked_by: ["cave-x", "cave-y"] }),
      blockedBead({ id: "cave-x", blocked_by: ["cave-deep"] }),
    ],
    [bead({ id: "cave-x", title: "Deeper", priority: 0 }), bead({ id: "cave-y", title: "Workable", priority: 3 })],
  );
  const top = cards.find((card) => card.bead.id === "cave-top")!;
  assert.equal(top.primary?.id, "cave-y", "cave-x outranks on priority but is itself blocked");
  assert.equal(top.primaryBasis, "only-actionable");
  assert.equal(top.blockers.find((b) => b.id === "cave-x")?.itselfBlocked, true);
});

test("when every blocker is itself blocked the card says the chain runs deeper", () => {
  const cards = buildGateCards(
    [
      blockedBead({ id: "cave-top", blocked_by: ["cave-x"] }),
      blockedBead({ id: "cave-x", blocked_by: ["cave-deep"] }),
    ],
    [bead({ id: "cave-x", title: "Deeper" })],
  );
  const top = cards.find((card) => card.bead.id === "cave-top")!;
  assert.equal(top.primaryBasis, "none-actionable");
  assert.match(gatePrimaryBasisText("none-actionable"), /chain runs deeper/);
});

test("a gate card offers no approval — there is no approve backend to call", () => {
  const [card] = buildGateCards([blockedBead({ id: "cave-top", blocked_by: ["cave-dep"] })], []);
  assert.deepEqual(Object.keys(card).sort(), ["bead", "blockers", "primary", "primaryBasis", "route", "unnamed"]);
  assert.equal(card.route?.beadId, "cave-dep");
});

// ── scheduler state is derived, never chosen ─────────────────────────────────

const POLL = 8000;
const NOW = 1_000_000;

test("scheduler state never reports live over data it did not read", () => {
  const base = { projectSelected: true, lastLoadedAtMs: NOW, nowMs: NOW, pollIntervalMs: POLL };
  assert.equal(
    deriveSchedulerStatus({ ...base, sources: { queue: true, roster: true, gates: true } }).kind,
    "live",
  );
  for (const down of ["queue", "roster", "gates"] as const) {
    const sources = { queue: true, roster: true, gates: true, [down]: false };
    const status = deriveSchedulerStatus({ ...base, sources });
    assert.equal(status.kind, "partial", `${down} failing must not read as live`);
    assert.match(status.detail, /Could not read/);
  }
});

test("a poll that stops refreshing reads as stale, and staleness outranks a partial read", () => {
  const sources = { queue: true, roster: false, gates: true };
  const fresh = deriveSchedulerStatus({
    projectSelected: true,
    sources,
    lastLoadedAtMs: NOW,
    nowMs: NOW + POLL * SCHEDULER_STALE_FACTOR,
    pollIntervalMs: POLL,
  });
  assert.equal(fresh.kind, "partial", "exactly at the threshold is not yet stale");
  const stale = deriveSchedulerStatus({
    projectSelected: true,
    sources,
    lastLoadedAtMs: NOW,
    nowMs: NOW + POLL * SCHEDULER_STALE_FACTOR + 1,
    pollIntervalMs: POLL,
  });
  assert.equal(stale.kind, "stale");
});

test("nothing loaded and no project each report themselves rather than an empty queue", () => {
  const sources = { queue: true, roster: true, gates: true };
  assert.equal(
    deriveSchedulerStatus({ projectSelected: true, sources, lastLoadedAtMs: null, nowMs: NOW, pollIntervalMs: POLL }).kind,
    "unavailable",
  );
  assert.equal(
    deriveSchedulerStatus({ projectSelected: false, sources, lastLoadedAtMs: NOW, nowMs: NOW, pollIntervalMs: POLL }).kind,
    "no-project",
  );
});

// ── history: an offered undo fires, and nothing else is offered ──────────────

/** A stand-in for `bd`: holds priorities and applies the route's own action. */
function fakeTracker(initial: Record<string, number>) {
  const state = { ...initial };
  return {
    state,
    post(body: Record<string, unknown>) {
      assert.equal(body.action, "priority", "the only mutation an undo may send");
      const id = body.id as string;
      const priority = body.priority as number;
      assert.ok(Number.isInteger(priority) && priority >= 0 && priority <= 4, "priority must be a real bd band");
      state[id] = priority;
    },
  };
}

test("an undo that is offered actually reverses the action when fired", () => {
  const tracker = fakeTracker({ "cave-1": 3 });

  // The surface's own mutation: promote cave-1 from Low to Critical.
  tracker.post({ action: "priority", id: "cave-1", priority: 0, projectRoot: "/repo" });
  assert.equal(tracker.state["cave-1"], 0);

  const entry = priorityLogEntry({
    id: "log-1",
    at: NOW,
    beadId: "cave-1",
    beadTitle: "Task",
    previousPriority: 3,
    priority: 0,
  });
  assert.ok(entry.undo, "a priority change is reversible and must offer an undo");
  assert.ok(schedulerLogEntryIsCoherent(entry));

  tracker.post(undoRequestBody(entry.undo, "/repo"));
  assert.equal(tracker.state["cave-1"], 3, "firing the offered undo restores the exact previous band");
});

test("reassign is recorded but never offers an undo, and says why", () => {
  const entry = reassignLogEntry({ id: "log-2", at: NOW, beadId: "cave-1", beadTitle: "Task", toLabel: "Nova" });
  assert.equal(entry.undo, null);
  assert.equal(entry.irreversible, REASSIGN_IRREVERSIBLE);
  assert.match(entry.irreversible, /previous assignee and status/);
  assert.ok(schedulerLogEntryIsCoherent(entry));
});

test("a priority change with no observed previous band offers no undo, and says why", () => {
  const entry = priorityLogEntry({
    id: "log-3",
    at: NOW,
    beadId: "cave-1",
    beadTitle: "Task",
    previousPriority: null,
    priority: 1,
  });
  assert.equal(entry.undo, null);
  assert.match(entry.irreversible ?? "", /previous priority/);
  assert.ok(schedulerLogEntryIsCoherent(entry));
});

test("every log entry the model can produce offers a firing undo or states why not", () => {
  const entries: SchedulerLogEntry[] = [
    reassignLogEntry({ id: "a", at: NOW, beadId: "b", beadTitle: "t", toLabel: "Nova" }),
    ...PRIORITY_BANDS.flatMap((band) =>
      [null, ...PRIORITY_BANDS.map((p) => p.value)].map((previous) =>
        priorityLogEntry({
          id: `p-${band.value}-${previous}`,
          at: NOW,
          beadId: "b",
          beadTitle: "t",
          previousPriority: previous,
          priority: band.value,
        }),
      ),
    ),
  ];
  for (const entry of entries) {
    assert.ok(schedulerLogEntryIsCoherent(entry), `${entry.id} must offer an undo XOR a reason`);
    if (entry.undo) {
      assert.equal(entry.undo.id, entry.beadId);
      assert.ok(Number.isInteger(entry.undo.priority));
    }
  }
});

test("an undone entry stops offering the undo it already fired", () => {
  const entry = priorityLogEntry({
    id: "log-1",
    at: NOW,
    beadId: "cave-1",
    beadTitle: "Task",
    previousPriority: 3,
    priority: 0,
  });
  const [after] = markSchedulerLogUndone([entry], "log-1");
  assert.equal(after.undone, true);
  assert.equal(after.undo, null, "the same undo must not be firable twice");
  assert.ok(schedulerLogEntryIsCoherent(after));
});

test("the history rail is newest-first and bounded", () => {
  let log: SchedulerLogEntry[] = [];
  for (let i = 0; i < SCHEDULER_LOG_LIMIT + 5; i += 1) {
    log = appendSchedulerLog(
      log,
      reassignLogEntry({ id: `e-${i}`, at: NOW + i, beadId: "b", beadTitle: "t", toLabel: "Nova" }),
    );
  }
  assert.equal(log.length, SCHEDULER_LOG_LIMIT);
  assert.equal(log[0].id, `e-${SCHEDULER_LOG_LIMIT + 4}`, "newest first");
});
