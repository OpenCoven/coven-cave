// @ts-nocheck
import assert from "node:assert/strict";

const {
  handoffTurns,
  deriveTaskTitleFromTurns,
  buildChatExcerpt,
  buildChatHandoffNotes,
  createTaskFromChat,
} = await import("./chat-task-handoff.ts");

const t = (id, role, text, extra = {}) => ({ id, role, text, ...extra });

// ── handoffTurns filtering ───────────────────────────────────────────────────
{
  const turns = [
    t("u1", "user", "do the thing"),
    t("s1", "system", "system chrome"),
    t("a1", "assistant", "on it"),
    t("a2", "assistant", "streaming…", { pending: true }),
    t("a3", "assistant", "boom", { error: true }),
    t("u2", "user", "   "),
  ];
  assert.deepEqual(
    handoffTurns(turns).map((x) => x.id),
    ["u1", "a1"],
    "system, pending, errored, and blank turns are dropped",
  );
}

// ── title derivation ─────────────────────────────────────────────────────────
{
  const turns = [
    t("a0", "assistant", "welcome!"),
    t("u1", "user", "Fix the flaky board test\nIt fails on CI only."),
  ];
  assert.equal(
    deriveTaskTitleFromTurns(turns),
    "Fix the flaky board test",
    "title is the first line of the first USER turn",
  );
}
assert.equal(
  deriveTaskTitleFromTurns([t("a1", "assistant", "only assistant spoke")]),
  "only assistant spoke",
  "falls back to the first usable turn of any role",
);
assert.equal(deriveTaskTitleFromTurns([]), "Task from chat", "empty chat gets a generic title");
{
  const long = "x".repeat(200);
  const title = deriveTaskTitleFromTurns([t("u1", "user", long)]);
  assert.ok(title.length <= 80, "long titles are truncated");
  assert.ok(title.endsWith("…"), "truncated titles end with an ellipsis");
}

// ── excerpt ──────────────────────────────────────────────────────────────────
{
  const turns = Array.from({ length: 10 }, (_, i) => t(`u${i}`, "user", `message ${i}`));
  const excerpt = buildChatExcerpt(turns, { maxTurns: 3 });
  assert.equal(
    excerpt,
    "user: message 7\n\nuser: message 8\n\nuser: message 9",
    "excerpt keeps the LAST maxTurns turns, role-prefixed",
  );
}
{
  const excerpt = buildChatExcerpt([t("a1", "assistant", "y".repeat(2000))]);
  assert.ok(excerpt.length < 800, "each turn's text is truncated");
  assert.ok(excerpt.startsWith("assistant: "), "turns carry their role");
}
assert.equal(buildChatExcerpt([]), "", "no usable turns → empty excerpt");

// ── notes / audit block ──────────────────────────────────────────────────────
{
  const turns = [
    t("u1", "user", "first ask"),
    t("a1", "assistant", "an answer"),
    t("u2", "user", "follow-up"),
  ];
  const notes = buildChatHandoffNotes({
    sessionId: "sess-123",
    turns,
    capturedAt: "2026-07-07T12:00:00.000Z",
    maxTurns: 2,
  });
  assert.match(notes, /^Source: chat session sess-123$/m, "notes name the source session");
  assert.match(notes, /^Turns: 2 of 3 \(a1 → u2\)$/m, "notes record which turns were captured");
  assert.match(notes, /^Captured: 2026-07-07T12:00:00\.000Z$/m, "notes record when");
  assert.match(notes, /Transcript excerpt:\n\nassistant: an answer\n\nuser: follow-up/, "notes end with the excerpt");
}
{
  const notes = buildChatHandoffNotes({ sessionId: "s", turns: [], capturedAt: "now" });
  assert.ok(!notes.includes("Transcript excerpt"), "no excerpt section when there are no turns");
  assert.match(notes, /Source: chat session s/, "audit block survives an empty chat");
}

// ── createTaskFromChat ───────────────────────────────────────────────────────
{
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ ok: true, card: { id: "card-1", title: captured.body.title } }) };
  };
  const res = await createTaskFromChat({
    sessionId: "sess-9",
    context: {
      turns: [t("u1", "user", "ship the widget")],
      familiarId: "fam-1",
      projectId: "proj-1",
    },
  });
  assert.equal(res.ok, true, "create succeeds");
  assert.equal(res.card.id, "card-1", "the created card is returned");
  assert.equal(captured.url, "/api/board", "posts to the board API");
  assert.equal(captured.body.status, "inbox", "new card lands in inbox");
  assert.equal(captured.body.sessionId, "sess-9", "card is linked to the source chat");
  assert.equal(captured.body.familiarId, "fam-1", "card inherits the chat's familiar");
  assert.equal(captured.body.projectId, "proj-1", "card inherits the chat's project");
  assert.deepEqual(captured.body.labels, ["chat-handoff"], "card is labeled as a chat handoff");
  assert.equal(captured.body.title, "ship the widget", "title derived from the turns");
  assert.match(captured.body.notes, /Source: chat session sess-9/, "notes carry the audit block");
}
{
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ok: true, card: { id: "c" } }) };
  };
  await createTaskFromChat({
    sessionId: "s",
    context: { turns: [t("u1", "user", "derived would be this")] },
    title: "  Explicit title  ",
  });
  assert.equal(captured.title, "Explicit title", "an explicit title wins over derivation, trimmed");
  assert.equal(captured.familiarId, null, "familiar defaults to null");
}
{
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: "title required" }) });
  const res = await createTaskFromChat({ sessionId: "s", context: { turns: [] } });
  assert.deepEqual(res, { ok: false, error: "title required" }, "API errors surface");
}
{
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  const res = await createTaskFromChat({ sessionId: "s", context: { turns: [] } });
  assert.deepEqual(res, { ok: false, error: "offline" }, "network failures are caught");
}

console.log("chat-task-handoff.test.ts: ok");
