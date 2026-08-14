// @ts-nocheck
/**
 * /api/github/diff — the bounds are the contract.
 *
 * The Review Deck reads this route for every pull-request review, and its "no
 * diff here" copy is chosen entirely from `noPatchReason`: a binary file GitHub
 * never sends a patch for reads differently from one this route's own budget
 * dropped. `total` exists so a capped response cannot report itself as complete.
 */

import assert from "node:assert/strict";
import test from "node:test";

const realFetch = globalThis.fetch;

/** Stand in for GitHub's pull-request files endpoint. */
function stubGitHub(payload: unknown, init: { status?: number } = {}) {
  const calls: string[] = [];
  globalThis.fetch = async (input: unknown) => {
    calls.push(String(input));
    const status = init.status ?? 200;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

function file(overrides = {}) {
  return { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+a", ...overrides };
}

function request(query = "repo=o%2Fr&number=7") {
  return new Request(`http://127.0.0.1/api/github/diff?${query}`);
}

const { GET } = await import("./route.ts");

test.after(() => {
  globalThis.fetch = realFetch;
});

test("a malformed repo or number never reaches GitHub", async () => {
  const calls = stubGitHub([]);
  for (const query of [
    "repo=not-a-repo&number=7",
    "repo=o%2Fr%2Fextra&number=7",
    "repo=&number=7",
    "repo=o%2Fr&number=0",
    "repo=o%2Fr&number=-3",
    "repo=o%2Fr&number=abc",
  ]) {
    const res = await GET(request(query));
    assert.equal(res.status, 400, query);
    assert.equal((await res.json()).ok, false);
  }
  assert.deepEqual(calls, [], "a rejected input must not be interpolated into a GitHub URL");
});

test("a clean pull request reports every file, untruncated", async () => {
  const calls = stubGitHub([file(), file({ filename: "src/b.ts", patch: "@@ -2 +2 @@\n-b" })]);
  const body = await (await GET(request())).json();
  assert.equal(body.ok, true);
  assert.equal(body.truncated, false);
  assert.equal(body.total, 2);
  assert.equal(body.files.length, 2);
  for (const entry of body.files) assert.equal(entry.noPatchReason, null);
  assert.match(calls[0], /\/repos\/o\/r\/pulls\/7\/files\?per_page=100$/);
});

test("a file GitHub sends no patch for is marked as GitHub's omission, not a truncation", async () => {
  stubGitHub([file({ filename: "logo.png", patch: undefined }), file()]);
  const body = await (await GET(request())).json();
  assert.equal(body.files[0].noPatchReason, "github");
  assert.equal(body.files[0].patch, null);
  // The file still earns its metadata row — the reader is told a change exists.
  assert.equal(body.files[0].filename, "logo.png");
  assert.equal(body.files[1].noPatchReason, null);
  // GitHub omitting a binary patch is not this route truncating anything.
  assert.equal(body.truncated, false);
});

test("patches past the shared budget keep their row and say the budget dropped them", async () => {
  // 20 files × 4_000 chars caps at the 60_000 budget partway through.
  const many = Array.from({ length: 20 }, (_, i) =>
    file({ filename: `src/f${i}.ts`, patch: "x".repeat(5_000) }),
  );
  stubGitHub(many);
  const body = await (await GET(request())).json();
  assert.equal(body.truncated, true);
  assert.equal(body.total, 20);
  assert.equal(body.files.length, 20, "every file keeps a metadata row");

  const dropped = body.files.filter((entry) => entry.noPatchReason === "budget");
  assert.ok(dropped.length > 0, "the budget must actually run out on this payload");
  for (const entry of dropped) assert.equal(entry.patch, null);
  // Nothing is misattributed to GitHub when it was this route's own budget.
  assert.equal(body.files.filter((entry) => entry.noPatchReason === "github").length, 0);

  const kept = body.files.filter((entry) => entry.patch !== null);
  const spent = kept.reduce((sum, entry) => sum + entry.patch.length, 0);
  assert.ok(spent <= 60_000, `patch budget overspent: ${spent}`);
  for (const entry of kept) assert.ok(entry.patch.length <= 4_000, "per-file slice exceeded");
});

test("a pull request past the file cap reports the total it could not list", async () => {
  const many = Array.from({ length: 63 }, (_, i) => file({ filename: `src/f${i}.ts`, patch: "@@\n+x" }));
  stubGitHub(many);
  const body = await (await GET(request())).json();
  assert.equal(body.files.length, 40, "capped at MAX_FILES");
  // Reporting 40 for a 63-file pull request would read as complete.
  assert.equal(body.total, 63);
  assert.equal(body.truncated, true);
});

test("GitHub's failures are passed through as themselves", async () => {
  stubGitHub({ message: "Not Found" }, { status: 404 });
  const missing = await GET(request());
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "not_found");

  stubGitHub({ message: "rate limited" }, { status: 403 });
  assert.equal((await GET(request())).status, 403);

  stubGitHub({ message: "boom" }, { status: 500 });
  assert.equal((await GET(request())).status, 502);

  // A 200 that isn't the array the route expects is a bad gateway, not a crash.
  stubGitHub({ message: "surprise" });
  const shaped = await GET(request());
  assert.equal(shaped.status, 502);
  assert.equal((await shaped.json()).ok, false);
});

test("an unreachable GitHub is an error payload, never a throw", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const res = await GET(request());
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, "network down");
});
