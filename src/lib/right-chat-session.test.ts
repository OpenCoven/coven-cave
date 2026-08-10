import assert from "node:assert/strict";
import { filterVisibleChatSessions } from "./chat-projects.ts";
import {
  eligibleRightChatSessions,
  isCurrentRightChatSessionsScope,
  resolveLatestRightChatSessionId,
} from "./right-chat-session.ts";
import type { SessionRow } from "./types.ts";

function row(
  id: string,
  overrides: Partial<SessionRow> & Pick<SessionRow, "created_at" | "updated_at" | "familiarId">,
): SessionRow {
  return {
    id,
    project_root: "/work/right-chat",
    harness: "codex",
    title: id,
    status: "completed",
    exit_code: null,
    archived_at: null,
    attention: { state: "none", since: null, reason: null },
    origin: "chat",
    hasLocalConversation: false,
    ...overrides,
  };
}

{
  const sessions = [
    row("cody-older", {
      familiarId: "cody",
      created_at: "2026-06-03T00:00:00.000Z",
      updated_at: "2026-06-03T00:00:00.000Z",
    }),
    row("nova-newer", {
      familiarId: "nova",
      created_at: "2026-06-07T00:00:00.000Z",
      updated_at: "2026-06-07T00:00:00.000Z",
    }),
    row("cody-newest", {
      familiarId: "cody",
      created_at: "2026-06-06T00:00:00.000Z",
      updated_at: "2026-06-06T00:00:00.000Z",
    }),
  ];

  assert.equal(
    resolveLatestRightChatSessionId(sessions, "cody"),
    "cody-newest",
    "the resolver should choose the exact familiar's newest visible chat, not another familiar's newer row",
  );
}

{
  const sessions = [
    row("visible", {
      familiarId: "cody",
      created_at: "2026-06-10T00:00:00.000Z",
      updated_at: "2026-06-10T00:00:00.000Z",
    }),
    row("archived", {
      familiarId: "cody",
      status: "archived",
      created_at: "2026-06-11T00:00:00.000Z",
      updated_at: "2026-06-11T00:00:00.000Z",
    }),
    row("generated", {
      familiarId: "cody",
      generated: true,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    }),
    row("killed-transcript-less", {
      familiarId: "cody",
      status: "killed",
      hasLocalConversation: false,
      created_at: "2026-06-13T00:00:00.000Z",
      updated_at: "2026-06-13T00:00:00.000Z",
    }),
    row("killed-recoverable", {
      familiarId: "cody",
      status: "killed",
      hasLocalConversation: true,
      created_at: "2026-06-14T00:00:00.000Z",
      updated_at: "2026-06-14T00:00:00.000Z",
    }),
  ];

  assert.deepEqual(
    eligibleRightChatSessions(sessions, "cody"),
    filterVisibleChatSessions(sessions, "cody"),
    "the right-chat adapter should reuse the canonical chat visibility policy",
  );
  assert.deepEqual(
    eligibleRightChatSessions(sessions, "cody").map((session) => session.id),
    ["killed-recoverable", "visible"],
    "visible rows stay available while archived, generated, and transcript-less dead runs stay out",
  );
}

{
  const sessions = [
    row("nova-only", {
      familiarId: "nova",
      created_at: "2026-06-15T00:00:00.000Z",
      updated_at: "2026-06-15T00:00:00.000Z",
    }),
  ];

  assert.equal(
    resolveLatestRightChatSessionId(sessions, "cody"),
    null,
    "the resolver must not fall back to another familiar when the exact familiar has no eligible chats",
  );
  assert.equal(
    resolveLatestRightChatSessionId(sessions, null),
    null,
    "the resolver must return null when no familiar is selected",
  );
}

{
  const sessions = [
    row("empty-string", {
      familiarId: "",
      created_at: "2026-06-16T00:00:00.000Z",
      updated_at: "2026-06-16T00:00:00.000Z",
    }),
  ];

  assert.deepEqual(
    eligibleRightChatSessions(sessions, ""),
    filterVisibleChatSessions(sessions, ""),
    "an empty string must still delegate to the canonical filter instead of short-circuiting like null",
  );
  assert.deepEqual(
    eligibleRightChatSessions(sessions, "").map((session) => session.id),
    ["empty-string"],
    "an empty-string familiar id should keep matching sessions instead of returning an empty list",
  );
}

// isCurrentRightChatSessionsScope (cave-rl980 Task 4 review): `undefined`
// always reports current so a caller that has not adopted the applied-scope
// contract yet (Workspace's own wiring lands in Task 7) keeps today's
// behavior, trusting `sessions` unconditionally.
{
  assert.equal(
    isCurrentRightChatSessionsScope(undefined, "cody"),
    true,
    "an unset scope (the pre-scope-aware contract) is always treated as current",
  );
  assert.equal(
    isCurrentRightChatSessionsScope(undefined, null),
    true,
    "an unset scope is current even when no familiar is active",
  );
}

// A concrete applied scope is compared directly against the familiar being
// resolved -- a match is current, anything else (including the still-in-
// flight OUTGOING familiar) is not.
{
  assert.equal(
    isCurrentRightChatSessionsScope("cody", "cody"),
    true,
    "a scope naming the exact active familiar is current",
  );
  assert.equal(
    isCurrentRightChatSessionsScope("cody", "nova"),
    false,
    "a scope still naming the OUTGOING familiar (sessions hasn't caught up to the switch yet) is not current",
  );
  assert.equal(
    isCurrentRightChatSessionsScope(null, "cody"),
    false,
    "an explicit null scope (e.g. an unscoped/all-familiars load) never matches a specific active familiar",
  );
  assert.equal(
    isCurrentRightChatSessionsScope(null, null),
    true,
    "an explicit null scope matches no active familiar",
  );
}

console.log("right-chat-session.test.ts: ok");
