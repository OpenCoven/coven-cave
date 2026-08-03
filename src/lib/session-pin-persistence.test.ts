// @ts-nocheck
// cave-ioswipe.6: pinning a chat must survive a refresh and reach other
// clients, so it is server state (`sessionPinned`) rather than device-local
// state. Mirrors `sessionKeep`: an ISO stamp when set, key absent when cleared.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { localConversationSessionRows, mergeSessionRows } from "./session-list-merge.ts";

const baseState = {
  sessionFamiliar: {},
  sessionTitles: {},
  sessionArchived: {},
  sessionSacrificed: {},
  sessionKeep: {},
  sessionPinned: {},
};

const conv = {
  sessionId: "local-1",
  familiarId: "nova",
  harness: "codex",
  title: "A chat",
  createdAt: "2026-08-03T10:00:00.000Z",
  updatedAt: "2026-08-03T10:05:00.000Z",
  initiator: { kind: "human", label: "Cave user", channel: "cave" },
};

// -- Local conversation rows ---------------------------------------------
const unpinned = localConversationSessionRows([conv], baseState, false);
assert.equal(unpinned.length, 1);
assert.ok(
  !("pinned" in unpinned[0]),
  "an unpinned row must OMIT the key, not carry pinned:false — the existing " +
    "deepEqual row tests assert exact shape and a always-present key breaks them",
);

const pinned = localConversationSessionRows(
  [conv],
  { ...baseState, sessionPinned: { "local-1": "2026-08-03T10:06:00.000Z" } },
  false,
);
assert.equal(pinned[0].pinned, true, "a pinned local conversation must surface pinned:true");

// -- Daemon session rows --------------------------------------------------
// The daemon path builds rows separately from the local-conversation path, so
// wiring one and not the other is a real failure mode: pin would survive on a
// UI-only chat and silently vanish on a daemon-backed one.
const daemonSession = {
  id: "daemon-1",
  project_root: "/tmp/proj",
  harness: "claude",
  title: "Daemon chat",
  status: "completed",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-08-03T09:00:00.000Z",
  updated_at: "2026-08-03T09:30:00.000Z",
};

const merged = mergeSessionRows({
  daemonSessions: [daemonSession],
  localConversations: [],
  state: { ...baseState, sessionPinned: { "daemon-1": "2026-08-03T10:06:00.000Z" } },
  includeArchived: false,
  isValidDaemonProjectRoot: () => true,
});
const daemonRow = merged.find((r) => r.id === "daemon-1");
assert.ok(daemonRow, "the daemon session must be listed");
assert.equal(daemonRow.pinned, true, "a pinned daemon session must surface pinned:true");

const mergedUnpinned = mergeSessionRows({
  daemonSessions: [daemonSession],
  localConversations: [],
  state: baseState,
  includeArchived: false,
  isValidDaemonProjectRoot: () => true,
});
assert.ok(
  !("pinned" in mergedUnpinned.find((r) => r.id === "daemon-1")),
  "an unpinned daemon row must omit the key too",
);

// -- Reconciliation registration -----------------------------------------
// These three lists are module-private constants, so this is a source check
// rather than a behavioural one. It is worth having: a new state map that is
// missing from STATE_MAPS is silently dropped when two cave-home states
// reconcile, and one missing from DELETABLE_STATE_MAPS makes UNPINNING
// un-mergeable — the delete is discarded and the pin resurrects. Neither
// failure is visible from the route or the merge.
const reconciliation = await readFile(
  new URL("./server/cave-home-reconciliation.ts", import.meta.url),
  "utf8",
);
for (const list of ["STATE_MAPS", "TIMESTAMP_STATE_MAPS", "DELETABLE_STATE_MAPS"]) {
  const block = reconciliation.match(new RegExp(`const ${list}[^\\[]*\\[(.*?)\\]`, "s"));
  assert.ok(block, `${list} must exist`);
  assert.match(
    block[1],
    /"sessionPinned"/,
    `sessionPinned must be registered in ${list}, or pin state is lost on reconciliation`,
  );
}

// -- Route contract -------------------------------------------------------
const route = await readFile(
  new URL("../app/api/sessions/[id]/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  route,
  /if \(typeof body\.pinned === "boolean"\) \{\s*\n\s*result\.pinned = await setSessionPinnedLocal\(id, body\.pinned\);/,
  "PATCH must apply pinned and echo it back",
);

console.log("session-pin-persistence: ok");
