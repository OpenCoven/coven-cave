// @ts-nocheck
// Smart chat → task autofill (chat "Create task" button). The pure derivation
// logic: links, GitHub links, priority keywords, natural-language due dates,
// and subtasks mined from assistant plan lists, assembled into a full board
// draft. UI wiring is guarded in chat-task-create-button-wiring.test.ts.
import assert from "node:assert/strict";

const {
  extractLinksFromTurns,
  extractGitHubLinksFromTurns,
  inferPriorityFromTurns,
  inferDueDateFromTurns,
  extractSubtasksFromTurns,
  buildTaskDraftFromChat,
  createSmartTaskFromChat,
} = await import("./chat-task-autofill.ts");

const t = (id, role, text, extra = {}) => ({ id, role, text, ...extra });

// ── link extraction ──────────────────────────────────────────────────────────
{
  const turns = [
    t("u1", "user", "See https://example.com/docs. and https://example.com/docs"),
    t("a1", "assistant", "Also https://other.dev/page?x=1) plus https://EXAMPLE.com/docs"),
    t("a2", "assistant", "pending link https://dropped.io", { pending: true }),
  ];
  assert.deepEqual(
    extractLinksFromTurns(turns),
    ["https://example.com/docs", "https://other.dev/page?x=1"],
    "URLs are deduped case-insensitively, trailing punctuation trimmed, pending turns skipped",
  );
}

// ── github extraction ────────────────────────────────────────────────────────
{
  const turns = [
    t("u1", "user", "Fix https://github.com/OpenCoven/coven-cave/issues/123 please"),
    t("a1", "assistant", "Related PR: https://github.com/OpenCoven/coven-cave/pull/456 and repo https://github.com/OpenCoven/coven-cave"),
  ];
  const github = extractGitHubLinksFromTurns(turns);
  assert.deepEqual(
    github.map((g) => [g.kind, g.repo, g.number]),
    [
      ["issue", "OpenCoven/coven-cave", 123],
      ["pr", "OpenCoven/coven-cave", 456],
      ["repo", "OpenCoven/coven-cave", undefined],
    ],
    "github URLs become structured issue/pr/repo links",
  );
}

// ── priority inference ───────────────────────────────────────────────────────
assert.equal(
  inferPriorityFromTurns([t("u1", "user", "this is URGENT, prod is down")]),
  "urgent",
  "urgent keywords → urgent",
);
assert.equal(
  inferPriorityFromTurns([t("u1", "user", "important: fix the login flow")]),
  "high",
  "importance keywords → high",
);
assert.equal(
  inferPriorityFromTurns([t("u1", "user", "no rush, whenever you get to it")]),
  "low",
  "relaxed keywords → low",
);
assert.equal(
  inferPriorityFromTurns([t("u1", "user", "please fix the login flow")]),
  "medium",
  "no signal → medium",
);
assert.equal(
  inferPriorityFromTurns([
    t("u1", "user", "no rush on this one"),
    t("a1", "assistant", "this is critical!"),
  ]),
  "urgent",
  "strongest signal wins across turns",
);

// ── due date inference ───────────────────────────────────────────────────────
// Local-time literal (not a Z-instant): "today" means the requester's local
// calendar date, so the fixture must be the same Wednesday in every runner TZ.
const wed = new Date(2026, 6, 15, 14, 30); // Wed 2026-07-15, local
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "ship it, due 2026-08-01")], wed),
  "2026-08-01",
  "explicit ISO deadline is used verbatim",
);
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "need this by tomorrow")], wed),
  "2026-07-16",
  "'by tomorrow' → next day",
);
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "can you do it by friday?")], wed),
  "2026-07-17",
  "'by friday' → upcoming friday",
);
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "target end of week")], wed),
  "2026-07-17",
  "'end of week' → upcoming friday",
);
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "sometime next week works")], wed),
  "2026-07-22",
  "'next week' → +7 days",
);
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "finish by eod")], wed),
  "2026-07-15",
  "'by eod' → today",
);
assert.equal(
  inferDueDateFromTurns([t("u1", "user", "no deadline mentioned")], wed),
  null,
  "no deadline → null endDate",
);

// cave-t7uz regression: UTC getters made "by today" resolve to tomorrow for
// evening users west of UTC. Pin the local-calendar-date contract with a UTC
// instant that falls on the previous local evening in western zones (e.g.
// 21:30 CDT), computing expectations from local getters so the assertion
// holds in any runner TZ.
{
  const lateEvening = new Date("2026-07-13T02:30:00.000Z");
  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  assert.equal(
    inferDueDateFromTurns([t("u1", "user", "need this done by today")], lateEvening),
    localDate(lateEvening),
    "'by today' → the requester's local calendar date, not the UTC date",
  );
  const localTomorrow = new Date(
    lateEvening.getFullYear(),
    lateEvening.getMonth(),
    lateEvening.getDate() + 1,
  );
  assert.equal(
    inferDueDateFromTurns([t("u1", "user", "due tomorrow")], lateEvening),
    localDate(localTomorrow),
    "'tomorrow' → local today + 1",
  );
}

// ── subtask extraction ───────────────────────────────────────────────────────
{
  const turns = [
    t("u1", "user", "plan the refactor"),
    t("a1", "assistant", "Old plan:\n- alpha\n- beta"),
    t("a2", "assistant", "Here's the plan:\n1. Extract the **parser** into `lib/`\n2. Add tests\n- Add tests\n3) Wire the UI\n\nDone."),
  ];
  assert.deepEqual(
    extractSubtasksFromTurns(turns),
    ["Extract the parser into lib/", "Add tests", "Wire the UI"],
    "steps come from the LAST assistant list, markdown stripped, deduped",
  );
}
assert.deepEqual(
  extractSubtasksFromTurns([t("a1", "assistant", "just prose\n- single stray bullet")]),
  [],
  "a single bullet is prose, not a plan",
);
assert.deepEqual(extractSubtasksFromTurns([t("u1", "user", "- user\n- lists\n- ignored")]), [], "user lists are not subtasks");

// ── full draft assembly ──────────────────────────────────────────────────────
{
  const turns = [
    t("u1", "user", "Fix the flaky auth test — it's urgent, by friday\nSee https://github.com/o/r/issues/9 and https://docs.example.com/auth"),
    t("a1", "assistant", "Plan:\n- [ ] Reproduce the flake\n- [x] Pin the seed"),
  ];
  const draft = buildTaskDraftFromChat({
    sessionId: "sess-1",
    context: { turns, familiarId: "fam-1", projectId: "proj-1" },
    now: wed,
  });
  assert.equal(draft.title, "Fix the flaky auth test — it's urgent, by friday");
  assert.equal(draft.status, "inbox");
  assert.equal(draft.priority, "urgent");
  assert.equal(draft.endDate, "2026-07-17");
  assert.equal(draft.sessionId, "sess-1");
  assert.equal(draft.familiarId, "fam-1");
  assert.equal(draft.projectId, "proj-1");
  assert.deepEqual(draft.labels, ["chat-handoff"]);
  assert.deepEqual(draft.links, ["https://docs.example.com/auth"], "github URLs stay out of plain links");
  assert.deepEqual(draft.github.map((g) => [g.kind, g.number]), [["issue", 9]]);
  assert.deepEqual(draft.steps, [{ text: "Reproduce the flake" }, { text: "Pin the seed" }]);
  assert.match(draft.notes, /Source: chat session sess-1/, "notes keep the audit trail");
  assert.match(draft.notes, /Transcript excerpt:/, "notes carry the excerpt");
}
{
  const draft = buildTaskDraftFromChat({
    sessionId: "sess-2",
    context: { turns: [t("u1", "user", "tidy the docs")] },
    title: "  Typed title wins  ",
    now: wed,
  });
  assert.equal(draft.title, "Typed title wins", "explicit title overrides derivation");
  assert.equal(draft.priority, "medium");
  assert.equal(draft.endDate, null);
  assert.deepEqual(draft.steps, []);
  assert.equal(draft.familiarId, null);
  assert.equal(draft.projectId, null);
}

// ── createSmartTaskFromChat posts the draft ──────────────────────────────────
{
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ ok: true, card: { id: "card-1", title: "t" } }),
    };
  };
  const result = await createSmartTaskFromChat({
    sessionId: "sess-3",
    context: {
      turns: [
        t("u1", "user", "urgent: fix https://github.com/o/r/pull/7 by tomorrow"),
        t("a1", "assistant", "Plan:\n- do a\n- do b"),
      ],
      familiarId: "fam-2",
      projectId: null,
    },
    now: wed,
  });
  assert.equal(result.ok, true);
  assert.equal(result.card.id, "card-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/board");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.priority, "urgent");
  assert.equal(body.endDate, "2026-07-16");
  assert.equal(body.status, "inbox");
  assert.equal(body.sessionId, "sess-3");
  assert.deepEqual(body.github.map((g) => g.number), [7]);
  assert.deepEqual(body.steps, [{ text: "do a" }, { text: "do b" }]);
}
{
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => null });
  const result = await createSmartTaskFromChat({
    sessionId: "sess-4",
    context: { turns: [t("u1", "user", "x")] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "HTTP 500");
}

console.log("chat-task-autofill.test.ts: ok");
