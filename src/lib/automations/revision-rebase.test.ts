import assert from "node:assert/strict";
import test from "node:test";
import type { CodexAutomation } from "../codex-automations-types.ts";
import {
  definitionMoved,
  readCurrentDefinition,
  rebaseValuePreview,
  rebasedPatch,
  reviewRevisionRebase,
  saveWithRevisionCheck,
  unresolvedConflicts,
} from "./revision-rebase.ts";

const base: CodexAutomation = {
  id: "nightly", name: "Nightly digest", kind: "cron", status: "ACTIVE", rrule: "RRULE:FREQ=DAILY;BYHOUR=9",
  model: null, reasoningEffort: null, executionEnvironment: null, cwds: ["/work/a"], tags: ["digest"], familiars: [],
  prompt: "## Goals\nSummarize the day.", skillPath: null, scheduleHuman: "Daily at 09:00",
};
// What the panel sends: every field, with the schedule as the builder writes it.
const formPatch = (changes: Record<string, unknown> = {}) => ({
  name: base.name, prompt: base.prompt, rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", model: "",
  reasoning_effort: "medium", execution_environment: "worktree", tags: base.tags, cwds: base.cwds, skill_path: "", ...changes,
});
const kinds = (rebase: ReturnType<typeof reviewRevisionRebase>) => Object.fromEntries(rebase.fields.map((entry) => [entry.field, entry.kind]));

test("each field is classified by who changed it, and the schedule builder's BYMINUTE=0 is no change", () => {
  const theirs = { ...base, prompt: "## Goals\nSummarize the week.", tags: ["digest", "weekly"], status: "PAUSED" as const };
  const rebase = reviewRevisionRebase(base, formPatch({ name: "Morning digest", tags: ["digest", "team"] }), theirs, 5);
  assert.deepEqual(kinds(rebase), { name: "mine", prompt: "theirs", rrule: "unchanged", model: "unchanged", cwd: "unchanged", tags: "conflict" });
  assert.equal(rebase.revision, 5);
  assert.deepEqual(rebase.statusChanged, { from: "ACTIVE", to: "PAUSED" });
});

test("a conflict blocks the rebased save until the person chooses", () => {
  const theirs = { ...base, name: "Evening digest" };
  const rebase = reviewRevisionRebase(base, formPatch({ name: "Morning digest", model: "opus" }), theirs, 7);
  assert.deepEqual(unresolvedConflicts(rebase, {}), ["name"]);
  assert.equal(rebasedPatch(rebase, {}), null);
  assert.deepEqual(rebasedPatch(rebase, { name: "mine" }), { name: "Morning digest", model: "opus" });
  // Choosing Coven's value leaves the field out, so Coven's change survives.
  assert.deepEqual(rebasedPatch(rebase, { name: "theirs" }), { model: "opus" });
});

test("only the person's kept fields are sent: Coven-only changes are never overwritten", () => {
  const theirs = { ...base, prompt: "Changed in Coven.", rrule: "RRULE:FREQ=DAILY;BYHOUR=18", cwds: ["/work/b"] };
  const rebase = reviewRevisionRebase(base, formPatch({ tags: [] }), theirs, 4);
  assert.deepEqual(rebasedPatch(rebase, {}), { tags: [] });
});

test("the same change on both sides needs nothing, and nothing left to save is reported as such", () => {
  const theirs = { ...base, name: "Morning digest" };
  const rebase = reviewRevisionRebase(base, formPatch({ name: "Morning digest" }), theirs, 3);
  assert.equal(kinds(rebase).name, "same");
  assert.equal(rebasedPatch(rebase, {}), null);
});

test("working directory and tags compare as Coven stores them", () => {
  assert.equal(definitionMoved(base, { ...base, cwds: ["/work/a", "/ignored"] }), false, "Coven keeps the first directory");
  assert.equal(definitionMoved(base, { ...base, status: "PAUSED" }), false, "the lifecycle state is not a field Save changes");
  assert.equal(definitionMoved(base, { ...base, rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0" }), false);
  assert.equal(definitionMoved(base, { ...base, tags: ["other"] }), true);
  const rebase = reviewRevisionRebase(base, formPatch({ cwds: [] }), base, 2);
  assert.deepEqual(rebasedPatch(rebase, {}), { cwds: [] });
});

test("long values are clipped for the review and empty ones are named", () => {
  assert.equal(rebaseValuePreview("prompt", "a\n\nb"), "a b");
  assert.equal(rebaseValuePreview("tags", "x\ny"), "x, y");
  assert.equal(rebaseValuePreview("tags", ""), "(no tags)");
  assert.equal(rebaseValuePreview("model", ""), "(empty)");
  assert.equal(rebaseValuePreview("prompt", "z".repeat(300)).length, 120);
});

type Call = { url: string; method: string; body?: Record<string, unknown> };
function fakeFetch(answers: ((call: Call) => { status: number; json: unknown } | Error)[]) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", ...(typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}) };
    calls.push(call);
    const answer = answers.shift()?.(call) ?? { status: 500, json: null };
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.json } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const snapshot = (automation: CodexAutomation, revision: number) => () => ({ status: 200, json: { ok: true, automation, revision } });

test("an unmoved definition is saved at the revision just read", async () => {
  const saved = { ...base, name: "Morning digest" };
  const { calls, restore } = fakeFetch([snapshot(base, 4), () => ({ status: 200, json: { ok: true, automation: saved } })]);
  try {
    const result = await saveWithRevisionCheck(base, formPatch({ name: "Morning digest" }));
    assert.deepEqual(result, { kind: "saved", automation: saved });
    assert.equal(calls[0].url, "/api/codex-automations/nightly/definition");
    assert.equal(calls[1].method, "PATCH");
    assert.equal(calls[1].body?.expectedRevision, 4);
  } finally { restore(); }
});

test("a definition that moved since the form loaded is reviewed, and nothing is written", async () => {
  const { calls, restore } = fakeFetch([snapshot({ ...base, prompt: "Changed in Coven." }, 6)]);
  try {
    const result = await saveWithRevisionCheck(base, formPatch({ name: "Morning digest" }));
    assert.equal(result.kind, "review");
    if (result.kind !== "review") return;
    assert.equal(result.rebase.revision, 6);
    assert.equal(calls.length, 1, "no PATCH");
  } finally { restore(); }
});

test("a conflict between the check and the save re-reads Coven and opens the review", async () => {
  const { calls, restore } = fakeFetch([
    snapshot(base, 4),
    () => ({ status: 409, json: { ok: false, conflict: true, currentRevision: 5 } }),
    snapshot({ ...base, tags: ["changed"] }, 5),
  ]);
  try {
    const result = await saveWithRevisionCheck(base, formPatch({ name: "Morning digest" }));
    assert.equal(result.kind, "review");
    assert.equal(result.kind === "review" && result.rebase.revision, 5);
    assert.equal(calls.length, 3);
  } finally { restore(); }
});

test("an unconfirmed revision, a deleted cron and a lost answer fail without writing over anything", async () => {
  let fake = fakeFetch([() => ({ status: 503, json: { ok: false, degraded: true } })]);
  try {
    assert.match(String((await saveWithRevisionCheck(base, formPatch()) as { message?: string }).message), /couldn't confirm Coven's current revision/);
    assert.equal(fake.calls.length, 1);
  } finally { fake.restore(); }
  fake = fakeFetch([() => ({ status: 404, json: { ok: false, error: "not found" } })]);
  try {
    assert.match(String((await saveWithRevisionCheck(base, formPatch()) as { message?: string }).message), /no longer holds this cron/);
  } finally { fake.restore(); }
  fake = fakeFetch([snapshot(base, 4), () => new TypeError("network")]);
  try {
    assert.match(String((await saveWithRevisionCheck(base, formPatch()) as { message?: string }).message), /may not have reached Coven/);
  } finally { fake.restore(); }
});

test("a malformed definition answer is unavailable, not a review", async () => {
  for (const json of [{ ok: true, automation: base, revision: 0 }, { ok: true, automation: { id: "nightly" }, revision: 2 }, null]) {
    const fake = fakeFetch([() => ({ status: 200, json })]);
    try {
      assert.deepEqual(await readCurrentDefinition("/api/codex-automations/nightly"), { kind: "unavailable" });
    } finally { fake.restore(); }
  }
});
