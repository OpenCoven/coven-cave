import assert from "node:assert/strict";
import test from "node:test";

import type { ChatTurn, ConversationFile, ConversationSummary } from "../../cave-conversations.ts";
import type { CaveProject } from "../../cave-projects-types.ts";
import type { VisibleFamiliarRosterEntry } from "../familiar-roster.ts";
import { parseClientV1JsonObject } from "./contract.ts";
import { compareClientV1AscendingKeys, compareClientV1RecencyKeys } from "./pagination.ts";
import {
  clientV1ConversationPageKey,
  clientV1ConversationSequence,
  clientV1FamiliarPageKey,
  clientV1MessagePageKey,
  clientV1ProjectPageKey,
  projectClientV1Conversation,
  projectClientV1Familiar,
  projectClientV1Message,
  projectClientV1Project,
  sortClientV1Conversations,
  sortClientV1Familiars,
  sortClientV1Projects,
} from "./reads.ts";

test("the familiar projection carries the roster's stated fields and omits the rest", () => {
  const entry: VisibleFamiliarRosterEntry = {
    id: "scribe",
    display_name: "Scribe",
    role: "Archivist",
    description: "Keeps the ledger.",
    pronouns: "they/them",
    status: "idle",
    last_seen: "2026-08-20T10:00:00.000Z",
    active_sessions: 2,
    memory_freshness: "fresh",
    emoji: "🖋",
    icon: "quill",
  };
  assert.deepEqual(projectClientV1Familiar(entry), {
    id: "scribe",
    displayName: "Scribe",
    role: "Archivist",
    description: "Keeps the ledger.",
    pronouns: "they/them",
    status: "idle",
    lastSeenAt: "2026-08-20T10:00:00.000Z",
    activeSessions: 2,
  });
});

test("the familiar projection drops optional fields instead of writing undefined", () => {
  // parseClientV1JsonValue refuses a key whose value is undefined, so a
  // projection that spreads `description: entry.description` throws inside the
  // envelope builder the first time a familiar has no description. Absence has
  // to be absence.
  const projected = projectClientV1Familiar({
    id: "mote",
    display_name: "Mote",
    role: "Familiar",
  });
  assert.deepEqual(Object.keys(projected).sort(), ["displayName", "id", "role"]);
  assert.doesNotThrow(() => parseClientV1JsonObject(projected));
});

test("the familiar projection refuses a non-integer session count and a blank last seen", () => {
  const projected = projectClientV1Familiar({
    id: "mote",
    display_name: "Mote",
    role: "Familiar",
    last_seen: "   ",
    active_sessions: 1.5,
  });
  assert.equal("lastSeenAt" in projected, false);
  assert.equal("activeSessions" in projected, false);
});

test("familiars sort by id because a familiar record carries no timestamp", () => {
  // The roster is a daemon read merged with familiars.toml; nothing in it has a
  // createdAt or an updatedAt. Ordering by anything else would be ordering by a
  // field that does not exist, so the identity is also the sort key — which is
  // total by construction.
  const roster: VisibleFamiliarRosterEntry[] = [
    { id: "warden", display_name: "Warden", role: "Guard" },
    { id: "adept", display_name: "Adept", role: "Scholar" },
    { id: "mote", display_name: "Mote", role: "Familiar" },
  ];
  assert.deepEqual(
    sortClientV1Familiars(roster).map((entry) => entry.id),
    ["adept", "mote", "warden"],
  );
  assert.deepEqual(clientV1FamiliarPageKey(roster[0]), { sort: "warden", id: "warden" });
  assert.equal(
    compareClientV1AscendingKeys(
      clientV1FamiliarPageKey(roster[1]),
      clientV1FamiliarPageKey(roster[0]),
    ) < 0,
    true,
  );
});

const PROJECT: CaveProject = {
  id: "p1",
  name: "Cave",
  root: "/Users/me/code/cave",
  color: "#123456",
  repoUrl: "https://github.com/OpenCoven/coven-cave",
  legacyRoot: "~/code/cave",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

test("the project projection publishes the registry record and not its migration marker", () => {
  assert.deepEqual(projectClientV1Project(PROJECT), {
    id: "p1",
    name: "Cave",
    root: "/Users/me/code/cave",
    color: "#123456",
    repoUrl: "https://github.com/OpenCoven/coven-cave",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  // legacyRoot exists to let the Cave's own web client re-key browser stores
  // after a root normalization. It is response-only scaffolding for that one
  // consumer, not part of what a project *is*, and publishing it would invite
  // an external client to key on a value the server strips before every write.
  assert.equal("legacyRoot" in projectClientV1Project(PROJECT), false);
  // `access` is a familiar-scoped view, absent on the operator registry read
  // this route performs. Publishing the field would state a permission answer
  // this route never computed.
  assert.equal("access" in projectClientV1Project({ ...PROJECT, access: "read" }), false);
});

test("projects page by createdAt because updatedAt moves under an open cursor", () => {
  // Both timestamps are required on a CaveProject, so either could key the
  // page. createdAt is the immutable one: a project patched between two page
  // requests changes its updatedAt, moves in the ordering, and is then either
  // served twice or skipped. createdAt cannot move.
  assert.deepEqual(clientV1ProjectPageKey(PROJECT), {
    sort: "2026-08-01T00:00:00.000Z",
    id: "p1",
  });
  const older: CaveProject = { ...PROJECT, id: "p0", createdAt: "2026-07-01T00:00:00.000Z" };
  const tied: CaveProject = { ...PROJECT, id: "p2" };
  assert.deepEqual(
    sortClientV1Projects([older, PROJECT, tied]).map((project) => project.id),
    ["p2", "p1", "p0"],
  );
  assert.equal(
    compareClientV1RecencyKeys(clientV1ProjectPageKey(tied), clientV1ProjectPageKey(PROJECT)) < 0,
    true,
    "a createdAt tie must break on the id, descending",
  );
});

const SUMMARY: ConversationSummary = {
  sessionId: "conversation-1",
  harnessSessionId: "harness-9",
  familiarId: "scribe",
  harness: "claude",
  model: "opus",
  runtime: "native",
  title: "Ledger cleanup",
  origin: "chat",
  branch: "feat/x",
  prUrl: "https://github.com/OpenCoven/coven-cave/pull/1",
  status: "completed",
  exitCode: 0,
  pending: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

test("the conversation projection reports the summary the sessions list is built from", () => {
  assert.deepEqual(projectClientV1Conversation(SUMMARY), {
    id: "conversation-1",
    familiarId: "scribe",
    harness: "claude",
    model: "opus",
    runtime: "native",
    title: "Ledger cleanup",
    origin: "chat",
    status: "completed",
    exitCode: 0,
    pending: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  // harnessSessionId rotates on every resume and is never the conversation's
  // identity; branch and prUrl are working-tree attribution for the Cave's own
  // PR badges. None of the three describe the conversation to a chat client.
  const projected = projectClientV1Conversation(SUMMARY);
  for (const leaked of ["harnessSessionId", "branch", "prUrl"]) {
    assert.equal(leaked in projected, false, leaked);
  }
});

test("the conversation projection tolerates the fields the store leaves optional", () => {
  const minimal = projectClientV1Conversation({
    sessionId: "conversation-2",
    familiarId: "mote",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.deepEqual(minimal, {
    id: "conversation-2",
    familiarId: "mote",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.doesNotThrow(() => parseClientV1JsonObject(minimal));
  // exitCode is `number | null` in the store — null means "no exit code yet",
  // which is a fact worth serving, unlike an absent field.
  assert.equal(
    projectClientV1Conversation({ ...SUMMARY, exitCode: null }).exitCode,
    null,
  );
});

test("conversations page by updatedAt, the one timestamp the summary always has", () => {
  // createdAt is optional on a ConversationSummary — a transcript written
  // before the field existed, or a corrupt-file fallback row, has none — so it
  // cannot be the sort key. updatedAt is required and is also the order
  // listConversations already serves, so a client sees one ordering from Cave.
  assert.deepEqual(clientV1ConversationPageKey(SUMMARY), {
    sort: "2026-08-09T00:00:00.000Z",
    id: "conversation-1",
  });
  const older: ConversationSummary = {
    sessionId: "conversation-0",
    familiarId: "mote",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
  const tied: ConversationSummary = { ...SUMMARY, sessionId: "conversation-3" };
  assert.deepEqual(
    sortClientV1Conversations([older, SUMMARY, tied]).map((row) => row.sessionId),
    ["conversation-3", "conversation-1", "conversation-0"],
  );
});

function turn(id: string, parentId: string | null, at: string, role: ChatTurn["role"] = "user"): ChatTurn {
  return { id, parentId, role, text: `text-${id}`, createdAt: at };
}

test("the message sequence follows the active branch, not the stored array order", () => {
  // turns is a tree flattened into one append-ordered array across every
  // branch. Serving that array is serving turns from branches the user
  // abandoned, interleaved with the live one.
  const conversation = {
    sessionId: "conversation-1",
    familiarId: "scribe",
    harness: "claude",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:03:00.000Z",
    activeLeafId: "t4",
    turns: [
      turn("t1", null, "2026-08-01T00:00:00.000Z"),
      turn("t2", "t1", "2026-08-01T00:01:00.000Z", "assistant"),
      turn("t3", "t1", "2026-08-01T00:02:00.000Z", "assistant"),
      turn("t4", "t3", "2026-08-01T00:03:00.000Z"),
    ],
  } satisfies ConversationFile;
  assert.deepEqual(
    clientV1ConversationSequence(conversation).map((entry) => entry.id),
    ["t1", "t3", "t4"],
  );
});

test("a conversation with no active leaf serves its stored order rather than nothing", () => {
  const conversation = {
    sessionId: "conversation-1",
    familiarId: "scribe",
    harness: "claude",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:01:00.000Z",
    turns: [
      turn("t1", null, "2026-08-01T00:00:00.000Z"),
      turn("t2", "t1", "2026-08-01T00:01:00.000Z", "assistant"),
    ],
  } satisfies ConversationFile;
  assert.deepEqual(
    clientV1ConversationSequence(conversation).map((entry) => entry.id),
    ["t1", "t2"],
  );
  // A transcript file whose turns array is missing or corrupt must read as an
  // empty transcript, never throw on the way to a 500.
  assert.deepEqual(
    clientV1ConversationSequence({ ...conversation, turns: undefined as unknown as ChatTurn[] }),
    [],
  );
});

test("the message projection keeps the transcript and drops the harness internals", () => {
  const source: ChatTurn = {
    id: "t2",
    parentId: "t1",
    role: "assistant",
    text: "Done.",
    createdAt: "2026-08-01T00:01:00.000Z",
    reasoning: "internal chain of thought",
    attachments: [{ id: "a1" } as never],
    tools: [
      { id: "tool-1", name: "bash", input: "ls ~/.ssh", output: "id_rsa", status: "ok" },
    ],
    usage: { input: 1 } as never,
    costUsd: 0.02,
    isError: false,
    cancelled: true,
  };
  const projected = projectClientV1Message("conversation-1", source);
  assert.deepEqual(projected, {
    id: "t2",
    conversationId: "conversation-1",
    parentId: "t1",
    role: "assistant",
    text: "Done.",
    createdAt: "2026-08-01T00:01:00.000Z",
    attachmentCount: 1,
    toolCount: 1,
    isError: false,
    cancelled: true,
  });
  // reasoning is the harness's private scratchpad and tool input/output carry
  // whatever the tool touched — the example above holds a private key path and
  // its contents. Counting them tells a client the turn did work without
  // handing over the work.
  const serialized = JSON.stringify(projected);
  for (const leaked of ["internal chain of thought", "id_rsa", "~/.ssh", "costUsd", "usage"]) {
    assert.equal(serialized.includes(leaked), false, leaked);
  }
});

test("the message projection normalizes a root turn's parent to null", () => {
  // parentId is `undefined` on a legacy turn and `null` on an authored root.
  // Both mean root, and `undefined` is not a value the envelope can carry.
  const legacy = projectClientV1Message("conversation-1", {
    id: "t1",
    role: "user",
    text: "hello",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(legacy.parentId, null);
  assert.doesNotThrow(() => parseClientV1JsonObject(legacy));
  assert.deepEqual(clientV1MessagePageKey({
    id: "t1",
    role: "user",
    text: "hello",
    createdAt: "2026-08-01T00:00:00.000Z",
  }), { sort: "2026-08-01T00:00:00.000Z", id: "t1" });
});
