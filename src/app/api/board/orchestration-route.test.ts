import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const caveHome = await mkdtemp(path.join(tmpdir(), "cave-board-orchestration-route-"));
process.env.HOME = caveHome;
process.env.COVEN_HOME = path.join(caveHome, ".coven");
process.env.COVEN_CAVE_HOME = caveHome;

const { POST } = await import("./route.ts");
const { PATCH } = await import("./[id]/route.ts");
const { POST: transition } = await import("./[id]/lifecycle/route.ts");

function request(method: "POST" | "PATCH", body: unknown): Request {
  return new Request("http://127.0.0.1/api/board", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const invalidCreate = await POST(request("POST", {
  title: "Invalid blocked task",
  status: "blocked",
}));
assert.equal(invalidCreate.status, 422);
const invalidCreateBody = await invalidCreate.json();
assert.equal(invalidCreateBody.error, "orchestration_invalid");
assert.deepEqual(
  new Set(invalidCreateBody.errors.map((error: { code: string }) => error.code)),
  new Set(["blocked_requires_dependency", "blocked_requires_next_step"]),
);

const malformedCreate = await POST(request("POST", {
  title: "Malformed dependency",
  dependencies: [null],
}));
assert.equal(malformedCreate.status, 422);
assert.ok(
  (await malformedCreate.json()).errors.some(
    (error: { code: string }) => error.code === "dependency_invalid",
  ),
);

const createdResponse = await POST(request("POST", { title: "Patch target" }));
assert.equal(createdResponse.status, 200);
const createdBody = await createdResponse.json();
const cardId = createdBody.card.id as string;

const invalidStatus = await PATCH(
  request("PATCH", { status: "teleported" }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(invalidStatus.status, 400);
assert.equal((await invalidStatus.json()).error, "invalid status");

const derivedStatus = await PATCH(
  request("PATCH", {
    status: "done",
    lifecycle: "failed",
    lifecycleReason: "Marked done from a linked chat",
    needsHuman: true,
  }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(derivedStatus.status, 200);
const derivedStatusBody = await derivedStatus.json();
assert.equal(derivedStatusBody.card.lifecycle, "completed");
assert.equal(derivedStatusBody.card.needsHuman, false);
assert.equal(derivedStatusBody.card.lifecycleReason, "Marked done from a linked chat");

const resetStatus = await PATCH(
  request("PATCH", { status: "backlog" }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(resetStatus.status, 200);

const invalidPatch = await PATCH(
  request("PATCH", {
    id: "forged-id",
    createdAt: "2000-01-01T00:00:00.000Z",
    status: "blocked",
  }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(invalidPatch.status, 422);
const invalidPatchBody = await invalidPatch.json();
assert.equal(invalidPatchBody.error, "orchestration_invalid");
assert.ok(
  invalidPatchBody.errors.some(
    (error: { code: string; field: string }) =>
      error.code === "blocked_requires_dependency" && error.field === "dependencies",
  ),
  "PATCH returns field-specific orchestration errors",
);

const rename = await PATCH(
  request("PATCH", {
    id: "forged-id",
    createdAt: "2000-01-01T00:00:00.000Z",
    title: "Renamed safely",
  }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(rename.status, 200);
const renamedBody = await rename.json();
assert.equal(renamedBody.card.id, cardId, "PATCH cannot replace the card id");
assert.notEqual(
  renamedBody.card.createdAt,
  "2000-01-01T00:00:00.000Z",
  "PATCH cannot replace createdAt",
);
assert.equal(renamedBody.card.title, "Renamed safely");

const approvalResponse = await POST(request("POST", {
  title: "Approval route target",
  nextStep: {
    summary: "Approve task dispatch",
    requiresApproval: true,
    origin: "human",
    updatedAt: new Date().toISOString(),
  },
}));
const approvalId = (await approvalResponse.json()).card.id as string;
const blockedDispatch = await transition(
  request("POST", { to: "dispatched" }),
  { params: Promise.resolve({ id: approvalId }) },
);
assert.equal(blockedDispatch.status, 422);
assert.ok(
  (await blockedDispatch.json()).errors.some(
    (error: { code: string }) => error.code === "next_step_requires_approval",
  ),
);

const malformedReason = await transition(
  request("POST", { to: "dispatched", reason: {} }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(malformedReason.status, 400);
assert.equal((await malformedReason.json()).error, "invalid reason");

const boardPath = path.join(caveHome, "board.json");
const boardFile = JSON.parse(await readFile(boardPath, "utf8"));
const transitionTarget = boardFile.cards.find(
  (card: { id: string }) => card.id === cardId,
);
transitionTarget.dependencies = [{
  id: "resolved-without-evidence",
  kind: "human",
  label: "Record the decision",
  state: "resolved",
  origin: "human",
  createdAt: new Date().toISOString(),
}];
await writeFile(boardPath, JSON.stringify(boardFile));

const invalidTransition = await transition(
  request("POST", { to: "dispatched" }),
  { params: Promise.resolve({ id: cardId }) },
);
assert.equal(invalidTransition.status, 422);
const invalidTransitionBody = await invalidTransition.json();
assert.equal(invalidTransitionBody.error, "orchestration_invalid");
assert.ok(
  invalidTransitionBody.errors.some(
    (error: { code: string }) => error.code === "dependency_needs_evidence",
  ),
  "lifecycle APIs preserve structured orchestration errors",
);

console.log("board/orchestration-route.test.ts: ok");
