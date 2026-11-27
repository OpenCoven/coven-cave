// A reserved task's first send dispatches it from any surface, on a real board
// file in an isolated home (#6562 slice 3).
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-first-send-"));
process.env.HOME = tmpHome;
process.env.COVEN_CAVE_HOME = tmpHome;

const iso = "2026-11-20T10:00:00.000Z";

function card(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    notes: "",
    status: "backlog",
    priority: "medium",
    familiarId: "nova",
    sessionId: `s-${id}`,
    nativeSessionId: `s-${id}`,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: iso,
    updatedAt: iso,
    lifecycle: "queued",
    lifecycleAt: iso,
    retryCount: 0,
    maxRetries: 3,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    primaryBlockerPinned: false,
    nextStep: null,
    ...overrides,
  };
}

const approvalStep = { summary: "Approve the plan", requiresApproval: true, origin: "human", updatedAt: iso };
const waitingOn = {
  id: "dep-1",
  kind: "human",
  label: "Decide the scope",
  taskId: null,
  ref: null,
  state: "unresolved",
  origin: "human",
  createdAt: iso,
};

await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({
    version: 2,
    cards: [
      card("ready"),
      card("linked", { nativeSessionId: undefined }),
      card("stale-marker", { sessionId: "s-other" }),
      card("inbox", { status: "inbox" }),
      card("approval", { nextStep: approvalStep }),
      card("waiting", { status: "blocked", dependencies: [waitingOn], primaryBlockerId: "dep-1", nextStep: { summary: "Ask about scope", requiresApproval: false, origin: "human", updatedAt: iso } }),
      card("running", { lifecycle: "running", status: "running", runningSince: iso }),
    ],
  }),
);

const board = await import("@/lib/cave-board");
const { dispatchTaskOnFirstSend, FIRST_SEND_LIVENESS_MS } = await import("@/lib/server/task-first-send");
const byId = async () => new Map((await board.loadBoard()).cards.map((entry) => [entry.id, entry]));

type Deps = NonNullable<Parameters<typeof dispatchTaskOnFirstSend>[1]>;
const waits: number[] = [];
// The real board and its lock; the run's liveness is the fixture.
const deps = (overrides: Partial<Deps> = {}): Deps => ({
  loadCards: async () => (await board.loadBoard()).cards,
  wait: async (ms) => { waits.push(ms); },
  hasActiveChatRun: () => true,
  loadTurns: async () => null,
  dispatch: (cardId, reason, onlyIf) => board.transitionCard(cardId, { to: "dispatched", reason, onlyIf }),
  ...overrides,
});

// A first send whose launch failed at once leaves the task queued for a retry.
for (const [why, turns] of [
  ["no run and no reply: the launch failed", null],
  ["the only reply errored", [{ role: "user" }, { role: "assistant", isError: true }]],
  ["the reply was stopped", [{ role: "user" }, { role: "assistant", cancelled: true }]],
] as const) {
  assert.equal(
    await dispatchTaskOnFirstSend("s-ready", deps({ hasActiveChatRun: () => false, loadTurns: async () => turns })),
    null,
    why,
  );
  assert.equal((await byId()).get("ready")!.lifecycle, "queued", why);
}
assert.ok(waits.every((ms) => ms === FIRST_SEND_LIVENESS_MS), "each check waits for the run to prove it started");

// A run that finished cleanly inside the window still counts.
{
  const quick = await dispatchTaskOnFirstSend(
    "s-ready",
    deps({ hasActiveChatRun: () => false, loadTurns: async () => [{ role: "user" }, { role: "assistant" }] }),
  );
  assert.equal(quick?.id, "ready", "a fast reply that succeeded starts the task");
}
let after = await byId();
assert.equal(after.get("ready")!.lifecycle, "dispatched");
assert.equal(after.get("ready")!.status, "running");
assert.match(after.get("ready")!.lifecycleReason ?? "", /Task chat started \(session s-ready\)/);

// Repeating it (the work view's own dispatch, a retried send) changes nothing.
const dispatchedAt = after.get("ready")!.lifecycleAt;
assert.equal(await dispatchTaskOnFirstSend("s-ready", deps()), null, "a second signal reports no move");
after = await byId();
assert.equal(after.get("ready")!.lifecycleAt, dispatchedAt, "a second first-send signal is a no-op");

// Everything that isn't a ready task's own reservation stays where it is.
for (const [sessionId, id, why] of [
  ["s-linked", "linked", "a chat someone linked is not a reservation"],
  ["s-stale-marker", "stale-marker", "a marker for a session the card no longer uses"],
  ["s-inbox", "inbox", "an untriaged task"],
  ["s-approval", "approval", "a next step awaiting approval blocks dispatch"],
  ["s-waiting", "waiting", "a task waiting on a blocker"],
  ["s-running", "running", "a task that already moved"],
] as const) {
  const before = (await byId()).get(id)!;
  assert.equal(await dispatchTaskOnFirstSend(sessionId, deps()), null, why);
  const now = (await byId()).get(id)!;
  assert.equal(now.lifecycle, before.lifecycle, why);
  assert.equal(now.updatedAt, before.updatedAt, `${why}: nothing is written`);
}
{
  const before = waits.length;
  assert.equal(await dispatchTaskOnFirstSend("s-unknown", deps()), null, "a plain chat has no task");
  assert.equal(waits.length, before, "a plain chat's send doesn't even wait");
}
assert.equal(await dispatchTaskOnFirstSend("", deps()), null);

// The session must still be the reservation when the lock is held, and a
// move another actor made first is not reported as this call's.
{
  let checked: boolean | null = null;
  const result = await dispatchTaskOnFirstSend("s-x", deps({
    loadCards: async () => [card("x") as never],
    dispatch: async (_id, _reason, onlyIf) => {
      checked = onlyIf(card("x", { sessionId: "s-relinked" }) as never, []);
      return card("x", { lifecycle: "dispatched", lifecycleAt: "2026-11-21T00:00:00.000Z" }) as never;
    },
  }));
  assert.equal(checked, false, "a session relinked before the lock is held is not dispatched");
  assert.equal(result, null, "a card this call didn't move is not reported as moved");
}

// A failure is logged, never thrown into the send.
{
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      await dispatchTaskOnFirstSend("s-ready", deps({ loadCards: async () => { throw new Error("disk full"); } })),
      null,
    );
  } finally {
    console.warn = originalWarn;
  }
}

// chat/send signals every first user turn it writes: the OpenClaw gateway
// dispatch, the OpenClaw bridge and the native/daemon stream paths.
{
  const send = await readFile(path.join(process.cwd(), "src/app/api/chat/send/route.ts"), "utf8");
  const stubs = send.match(/createConversationStub\(\{/g) ?? [];
  const signals = send.match(/\.then\(async \(created\) => \{\s*\/\/ The session's first prompt landed: start its task \(#6562\)\.\s*if \(created\) void dispatchTaskOnFirstSend\((conversationId|announcedId)\);/g) ?? [];
  assert.equal(stubs.length, 3, "chat/send writes a first user turn in three places");
  assert.equal(signals.length, stubs.length, "each first-turn write starts its task, without awaiting it");
  const lost = send.match(/\}\)\.catch\(\(\) => \{\s*\/\/ A lost stub still saves the turn at stream close; don't strand the task\.\s*void dispatchTaskOnFirstSend\((conversationId|announcedId)\);/g) ?? [];
  assert.equal(lost.length, stubs.length, "a failed first-turn write still starts its task");
}

console.log("task-first-send: ok");
