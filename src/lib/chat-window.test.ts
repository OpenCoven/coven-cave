import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_WINDOW_DRAFT_KEY_PREFIX,
  CHAT_WINDOW_FAMILIAR_KEY,
  chatWindowActivityLabel,
  chatWindowChatState,
  chatWindowHref,
  chatWindowTargetFromEvent,
  normalizeChatWindowTarget,
  readChatWindowTarget,
  resolveChatWindowFamiliarId,
  summarizeChatWindowActivity,
} from "./chat-window.ts";
import type { SessionRow } from "./types.ts";

function row(id: string, overrides: Partial<SessionRow>): SessionRow {
  return {
    id,
    project_root: "/work/chat-window",
    harness: "codex",
    title: id,
    status: "completed",
    exit_code: null,
    archived_at: null,
    created_at: "2026-11-12T10:00:00.000Z",
    updated_at: "2026-11-12T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    origin: "chat",
    hasLocalConversation: true,
    ...overrides,
  };
}

describe("chat window target", () => {
  it("round-trips a pop-out target through the window URL", () => {
    const href = chatWindowHref({ familiarId: "nova", sessionId: "01JABC-def_2.3:4" });
    assert.equal(href, "/quick-chat?view=window&familiar=nova&session=01JABC-def_2.3%3A4");
    assert.deepEqual(readChatWindowTarget(href.slice(href.indexOf("?"))), {
      familiarId: "nova",
      sessionId: "01JABC-def_2.3:4",
    });
  });

  it("opens with no target as a bare window", () => {
    assert.equal(chatWindowHref({ familiarId: null, sessionId: null }), "/quick-chat?view=window");
    assert.deepEqual(readChatWindowTarget("?view=window"), { familiarId: null, sessionId: null });
  });

  it("drops anything that is not a plain bounded id, like the shell does", () => {
    assert.deepEqual(
      normalizeChatWindowTarget({ familiarId: 'nova"});alert(1);//', sessionId: "a".repeat(201) }),
      { familiarId: null, sessionId: null },
    );
    assert.deepEqual(normalizeChatWindowTarget({ familiarId: " nova ", sessionId: 7 }), {
      familiarId: "nova",
      sessionId: null,
    });
    assert.deepEqual(normalizeChatWindowTarget(null), { familiarId: null, sessionId: null });
    assert.deepEqual(readChatWindowTarget("?familiar=../../etc&session=%3Cscript%3E"), {
      familiarId: null,
      sessionId: null,
    });
  });

  it("reads a later pop-out from the DOM event and ignores an empty one", () => {
    const event = (detail: unknown) => ({ detail }) as unknown as Event;
    assert.deepEqual(chatWindowTargetFromEvent(event({ familiarId: "sage", sessionId: null })), {
      familiarId: "sage",
      sessionId: null,
    });
    assert.equal(chatWindowTargetFromEvent(event({})), null);
    assert.equal(chatWindowTargetFromEvent(event("nova")), null);
  });
});

describe("chat window familiar", () => {
  it("prefers the pop-out target, then the last familiar it showed, then the first", () => {
    const ids = ["nova", "sage", "wren"];
    assert.equal(resolveChatWindowFamiliarId(ids, ["sage", "wren"]), "sage");
    assert.equal(resolveChatWindowFamiliarId(ids, [null, "wren"]), "wren");
    assert.equal(resolveChatWindowFamiliarId(ids, ["gone", undefined]), "nova");
    assert.equal(resolveChatWindowFamiliarId([], ["nova"]), null);
  });

  it("keeps its selection and drafts under its own storage keys", () => {
    // The main window's active familiar and the docked panel's drafts live
    // under other keys; sharing one would let either window move the other.
    assert.match(CHAT_WINDOW_FAMILIAR_KEY, /^cave:chat-window:/);
    assert.match(CHAT_WINDOW_DRAFT_KEY_PREFIX, /^cave:chat-window-/);
    assert.notEqual(CHAT_WINDOW_DRAFT_KEY_PREFIX, "cave:right-chat-composer-draft:v1:");
  });
});

describe("chat window activity", () => {
  it("counts replies in progress and chats waiting on the person, per familiar", () => {
    const summary = summarizeChatWindowActivity([
      row("a", { familiarId: "nova", status: "running" }),
      row("b", { familiarId: "nova", status: "running" }),
      row("c", { familiarId: "nova", attention: { state: "awaiting-human", since: null, reason: null } }),
      row("d", { familiarId: "sage", attention: { state: "overdue-human", since: null, reason: null } }),
      row("e", { familiarId: "wren" }),
    ]);
    assert.deepEqual(summary.get("nova"), { running: 2, waiting: 1 });
    assert.deepEqual(summary.get("sage"), { running: 0, waiting: 1 });
    assert.equal(summary.has("wren"), false, "an idle familiar has no badge");
  });

  it("does not mark a chat that was merely left unanswered", () => {
    // Left hanging is true of nearly every finished chat; marking it would
    // light every row and every familiar.
    const hanging = row("h", { familiarId: "nova", attention: { state: "left-hanging", since: null, reason: null } });
    assert.equal(chatWindowChatState(hanging), null);
    assert.equal(summarizeChatWindowActivity([hanging]).size, 0);
    assert.equal(chatWindowChatState(row("r", { status: "running" })), "running");
    assert.equal(
      chatWindowChatState(row("a", { attention: { state: "awaiting-human", since: null, reason: null } })),
      "awaiting",
    );
  });

  it("never lights a badge for a chat the list would hide", () => {
    const summary = summarizeChatWindowActivity([
      row("archived", { familiarId: "nova", status: "running", archived_at: "2026-11-12T11:00:00.000Z" }),
      row("generated", { familiarId: "nova", status: "running", generated: true }),
      row("unowned", { familiarId: null, status: "running" }),
    ]);
    assert.equal(summary.size, 0);
  });

  it("reads activity out in words, since a dot alone is not a signal", () => {
    assert.equal(chatWindowActivityLabel(undefined), "");
    assert.equal(chatWindowActivityLabel({ running: 1, waiting: 0 }), "1 reply in progress");
    assert.equal(
      chatWindowActivityLabel({ running: 2, waiting: 3 }),
      "2 replies in progress, 3 chats awaiting you",
    );
    assert.equal(chatWindowActivityLabel({ running: 0, waiting: 1 }), "1 chat awaiting you");
  });
});
