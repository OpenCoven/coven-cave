import assert from "node:assert/strict";
import test from "node:test";

import { addableFamiliars, promoteSessionToCoven } from "./coven-promotion.ts";
import { makeGroup, type CovenGroup } from "./group-chat.ts";

const NOW = "2026-07-31T22:00:00.000Z";
const HOST = { id: "nova", name: "Nova" };
const CODY = { id: "cody", name: "Cody" };
const MILO = { id: "milo", name: "Milo" };

test("the host's live thread is carried into the new coven", () => {
  const { group, carriedSession, groups } = promoteSessionToCoven({
    groups: [],
    host: HOST,
    added: [CODY],
    sessionId: "sess-abc",
    projectId: "proj-1",
    now: NOW,
    groupId: "g1",
  });

  assert.equal(carriedSession, true);
  assert.deepEqual(group.familiarIds, ["nova", "cody"], "host leads the roster");
  assert.equal(
    group.sessions.nova,
    "sess-abc",
    "the thread you were in becomes the host's session — the conversation continues",
  );
  assert.equal(group.sessions.cody, undefined, "the added familiar starts fresh");
  assert.equal(group.projectId, "proj-1");
  assert.equal(group.responseMode, "broadcast", "a new coven defaults to broadcast");
  assert.deepEqual(groups, [group], "the group is returned in the persisted list");
});

// The ordering bug this guards is silent: setGroupProject clears `sessions`
// because harness session ids are cwd-scoped, so pinning the carried thread
// before setting the project would drop it with no error anywhere.
test("setting the project does not discard the carried thread", () => {
  const { group } = promoteSessionToCoven({
    groups: [],
    host: HOST,
    added: [CODY],
    sessionId: "sess-abc",
    projectId: "proj-1",
    now: NOW,
    groupId: "g1",
  });
  assert.equal(group.projectId, "proj-1");
  assert.equal(group.sessions.nova, "sess-abc", "project assignment ran BEFORE the session pin");
});

test("a chat with no project still promotes", () => {
  const { group } = promoteSessionToCoven({
    groups: [],
    host: HOST,
    added: [CODY],
    sessionId: "sess-abc",
    projectId: null,
    now: NOW,
    groupId: "g1",
  });
  assert.equal(group.projectId, undefined);
  assert.equal(group.sessions.nova, "sess-abc");
});

test("a chat that never started carries no session", () => {
  const { group, carriedSession } = promoteSessionToCoven({
    groups: [],
    host: HOST,
    added: [CODY],
    sessionId: null,
    projectId: "proj-1",
    now: NOW,
    groupId: "g1",
  });
  assert.equal(carriedSession, false);
  assert.deepEqual(group.sessions, {}, "nothing to carry, nothing pinned");
});

test("adding several familiars at once names the coven after all of them", () => {
  const { group } = promoteSessionToCoven({
    groups: [],
    host: HOST,
    added: [CODY, MILO],
    sessionId: null,
    projectId: null,
    now: NOW,
    groupId: "g1",
  });
  assert.deepEqual(group.familiarIds, ["nova", "cody", "milo"]);
  assert.equal(group.name, "Nova, Cody +1");
});

test("the host is never duplicated if it is also passed as added", () => {
  const { group } = promoteSessionToCoven({
    groups: [],
    host: HOST,
    added: [HOST, CODY],
    sessionId: "sess-abc",
    projectId: null,
    now: NOW,
    groupId: "g1",
  });
  assert.deepEqual(group.familiarIds, ["nova", "cody"]);
});

test("promotion preserves existing covens", () => {
  const existing: CovenGroup = makeGroup("Old coven", ["milo"], "2026-07-30T00:00:00.000Z", "g0");
  const { groups, group } = promoteSessionToCoven({
    groups: [existing],
    host: HOST,
    added: [CODY],
    sessionId: null,
    projectId: null,
    now: NOW,
    groupId: "g1",
  });
  assert.equal(groups.length, 2, "the earlier coven is still there");
  assert.equal(groups[0].id, group.id, "the new one sorts first (most recently updated)");
  assert.ok(groups.some((g) => g.id === "g0"));
});

test("addable familiars exclude the host and anyone already added", () => {
  const roster = [{ id: "nova" }, { id: "cody" }, { id: "milo" }];
  assert.deepEqual(addableFamiliars(roster, "nova"), [{ id: "cody" }, { id: "milo" }]);
  assert.deepEqual(addableFamiliars(roster, "nova", ["cody"]), [{ id: "milo" }]);
  assert.deepEqual(addableFamiliars(roster, "nova", ["cody", "milo"]), []);
});

console.log("coven-promotion.test.ts: ok");
