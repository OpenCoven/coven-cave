import assert from "node:assert/strict";
import test from "node:test";
import {
  ChangesRequestError,
  fetchSessionCheckpoints,
  fetchSessionFileDiff,
  mutateSessionChanges,
  type ChangesFetch,
} from "./session-changes-api.ts";

function responding(json: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => json };
}

test("session changes API keeps query paths and mutation payloads stable", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: ChangesFetch = async (input, init) => {
    calls.push({ input, init });
    if (input.includes("checkpoints")) return responding({ ok: true, checkpoints: [{ name: "c1", savedAt: "now", bytes: 4 }] });
    if (input.includes("path")) return responding({ ok: true, diff: "diff --git", truncated: true });
    return responding({ ok: true, checkpointPath: "c2" });
  };

  assert.deepEqual(await fetchSessionCheckpoints(fetchImpl, "/project root"), [{ name: "c1", savedAt: "now", bytes: 4 }]);
  assert.deepEqual(await fetchSessionFileDiff(fetchImpl, "/project root", "src/a.ts"), { diff: "diff --git", truncated: true });
  assert.deepEqual(await mutateSessionChanges(fetchImpl, "/project root", "checkpoint"), { ok: true, checkpointPath: "c2" });
  assert.match(calls[0]?.input ?? "", /projectRoot=%2Fproject\+root&checkpoints=1/);
  assert.match(calls[1]?.input ?? "", /path=src%2Fa.ts/);
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { projectRoot: "/project root", action: "checkpoint" });
});

test("session changes API surfaces route error messages", async () => {
  const failed: ChangesFetch = async () => responding({ ok: false, error: "no repository" }, false, 409);
  await assert.rejects(() => fetchSessionCheckpoints(failed, "/project"), /no repository/);
});

test("a refusal because the branch moved is marked stale (#5756)", async () => {
  const stale: ChangesFetch = async () => responding({ ok: false, stale: true, error: "the branch changed after the commit" }, false, 409);
  const error = await mutateSessionChanges(stale, "/project", "create-pr", {}).catch((err) => err);
  assert.ok(error instanceof ChangesRequestError);
  assert.equal(error.stale, true);
  assert.equal(error.status, 409);
  assert.match(error.message, /branch changed/);
  const plain: ChangesFetch = async () => responding({ ok: false, error: "push failed" }, false, 502);
  const other = await mutateSessionChanges(plain, "/project", "create-pr", {}).catch((err) => err);
  assert.equal(other.stale, false);
});

test("a changes action that never answers lets go, and says it may have happened (#5781)", async () => {
  const seen: (AbortSignal | undefined)[] = [];
  const hung = (async (_input: string, init?: RequestInit) => {
    seen.push(init?.signal ?? undefined);
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as never;
  const err = await mutateSessionChanges(hung, "/project", "commit", {}).catch((error) => error);
  assert.ok(seen[0] instanceof AbortSignal, "the request carries a time limit");
  assert.equal(err.status, 0);
  assert.equal(err.stale, false);
  assert.match(err.message, /^no answer in 180 seconds\. It may have happened anyway: check the changes before trying again$/);
  const revert = await mutateSessionChanges(hung, "/project", "revert", {}).catch((error) => error);
  assert.match(revert.message, /^no answer in 150 seconds\./);
});
