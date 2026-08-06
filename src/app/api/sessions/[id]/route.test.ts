// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const previousEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
};
const scratchRoot = path.join(process.cwd(), `.sessions-id-route-${process.pid}`);
const covenHome = path.join(scratchRoot, "coven-home");
const caveHome = path.join(covenHome, "cave");

process.env.COVEN_HOME = covenHome;
process.env.COVEN_CAVE_HOME = caveHome;

try {
  await rm(scratchRoot, { recursive: true, force: true });
  await mkdir(caveHome, { recursive: true });

  const { saveConversation } = await import("@/lib/cave-conversations");
  const { loadState } = await import("@/lib/cave-config");
  const { DELETE, PATCH } = await import("./route.ts");

  await saveConversation({
    sessionId: "stable-delete-root",
    harnessSessionId: "stable-delete-root",
    familiarId: "charm",
    harness: "claude",
    title: "Delete linked replay",
    createdAt: "2026-08-05T20:00:00.000Z",
    updatedAt: "2026-08-05T20:01:00.000Z",
    replaySessions: [
      {
        sessionId: "daemon-delete-1",
        conversationId: "stable-delete-root",
        createdAt: "2026-08-05T20:00:00.000Z",
        updatedAt: "2026-08-05T20:00:30.000Z",
      },
      {
        sessionId: "daemon-delete-2",
        conversationId: "stable-delete-root",
        createdAt: "2026-08-05T20:00:30.000Z",
        updatedAt: "2026-08-05T20:01:00.000Z",
      },
    ],
    turns: [],
  });

  const response = await DELETE(
    new Request("http://localhost/api/sessions/daemon-delete-1", {
      method: "DELETE",
      headers: { host: "localhost" },
    }),
    { params: Promise.resolve({ id: "daemon-delete-1" }) },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);

  const state = await loadState();
  for (const id of ["stable-delete-root", "daemon-delete-1", "daemon-delete-2"]) {
    assert.equal(
      typeof state.sessionSacrificed[id],
      "string",
      `general session delete sacrifices linked id ${id}`,
    );
  }

  await saveConversation({
    sessionId: "stable-archive-root",
    harnessSessionId: "codex-thread-archive",
    familiarId: "charm",
    harness: "claude",
    title: "Archive linked replay",
    createdAt: "2026-08-05T20:10:00.000Z",
    updatedAt: "2026-08-05T20:11:00.000Z",
    replaySessions: [
      {
        sessionId: "daemon-archive-old",
        conversationId: "codex-thread-archive",
        createdAt: "2026-08-05T20:10:00.000Z",
        updatedAt: "2026-08-05T20:10:30.000Z",
      },
      {
        sessionId: "daemon-archive-new",
        conversationId: "codex-thread-archive",
        createdAt: "2026-08-05T20:10:30.000Z",
        updatedAt: "2026-08-05T20:11:00.000Z",
      },
    ],
    turns: [],
  });

  const archiveResponse = await PATCH(
    new Request("http://localhost/api/sessions/daemon-archive-old", {
      method: "PATCH",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }),
    { params: Promise.resolve({ id: "daemon-archive-old" }) },
  );
  assert.equal(archiveResponse.status, 200);
  const archiveJson = await archiveResponse.json();
  assert.equal(archiveJson.ok, true);
  assert.equal(typeof archiveJson.archivedAt, "string");

  const archivedState = await loadState();
  assert.equal(
    archivedState.sessionArchived["stable-archive-root"],
    archiveJson.archivedAt,
    "archiving through an older replay alias canonicalizes onto the stable conversation id",
  );
  assert.equal(
    archivedState.sessionArchived["daemon-archive-old"],
    undefined,
    "archive state is keyed only by the canonical conversation id",
  );

  console.log("sessions/[id]/route.test.ts: ok");
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
  if (previousEnv.COVEN_HOME === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousEnv.COVEN_HOME;
  if (previousEnv.COVEN_CAVE_HOME === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousEnv.COVEN_CAVE_HOME;
}
