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
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const mergeBaseSha = "c".repeat(40);
const revision = { repo: "o/r", number: 7, headSha, baseSha, baseRef: "main", mergeBaseSha };

/** Stand in for GitHub's pull-request files endpoint. */
function stubGitHub(payload: unknown, init: { status?: number } = {}) {
  const calls: string[] = [];
  globalThis.fetch = async (input: unknown) => {
    calls.push(String(input));
    const status = init.status ?? 200;
    const data = status !== 200 || !Array.isArray(payload) || String(input).includes("/files?") ? payload
      : String(input).endsWith("/pulls/7")
        ? { head: { sha: headSha }, base: { sha: baseSha, ref: "main" } }
        : { base_commit: { sha: baseSha }, merge_base_commit: { sha: mergeBaseSha }, files: payload };
    return new Response(JSON.stringify(data), {
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
  assert.deepEqual(body.revision, revision);
  assert.equal(calls[1], `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}?per_page=1`);
  assert.equal(calls.some((url) => url.includes("/files?")), false);
});

test("an author push cannot relabel the immutable patch with a newer head", async () => {
  const calls = stubGitHub([file({ patch: "+revision A" })]);
  const body = await (await GET(request())).json();
  assert.equal(body.revision?.headSha, headSha);
  assert.equal(body.files[0].patch, "+revision A");
  assert.ok(calls[1].includes(`${baseSha}...${headSha}`));
});

test("fork heads use network-wide immutable SHAs, independent of fork names and moving refs", async () => {
  // Shape and OIDs from the read-only cli/cli#14373 public fork comparison.
  const base = "0d121e8c31204cdbe02b4a4b1be5e88bdc3c4662";
  const head = "682398a89f408d305fba87c2be1c25864aab4077";
  const compareUrl = `https://api.github.com/repos/cli/cli/compare/${base}...${head}?per_page=1`;
  for (const headRepo of [
    { full_name: "acoulton/cli", name: "cli", owner: { login: "acoulton" } },
    { full_name: "new-owner/renamed-cli", name: "renamed-cli", owner: { login: "new-owner" } },
    null,
  ]) {
    const calls: string[] = [];
    const pull = {
      head: { sha: head, ref: "patch-1", repo: headRepo },
      base: { sha: base, ref: "trunk", repo: { full_name: "cli/cli" } },
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://api.github.com/repos/cli/cli/pulls/14373") return Response.json(pull);
      assert.equal(url, compareUrl, "never resolve a mutable owner:branch or pulls/files target");
      pull.head.sha = "d".repeat(40);
      pull.head.ref = "renamed-and-pushed";
      return Response.json({
        base_commit: { sha: base }, merge_base_commit: { sha: base },
        commits: [{ sha: head }], files: [file({ filename: "docs/install_linux.md", patch: "+synthetic fork patch" })],
      });
    };
    const response = await GET(request("repo=cli%2Fcli&number=14373"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.revision, { repo: "cli/cli", number: 14373, baseSha: base, baseRef: "trunk", headSha: head, mergeBaseSha: base });
    assert.equal(body.files[0].patch, "+synthetic fork patch");
    assert.equal(calls.length, 2);
  }
});

test("an inaccessible comparison fails visibly without retrying mutable fork refs or PR files", async () => {
  for (const status of [403, 404]) {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return String(input).endsWith("/pulls/7")
        ? Response.json({ head: { sha: headSha, ref: "feature", repo: { full_name: "fork/renamed" } }, base: { sha: baseSha, ref: "main" } })
        : Response.json({ message: "Resource is not accessible" }, { status });
    };
    const response = await GET(request());
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.ok(body.error);
    assert.equal(body.files, undefined);
    assert.equal(body.revision, undefined);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].endsWith(`/compare/${baseSha}...${headSha}?per_page=1`));
  }
});

test("missing or inconsistent comparison identity fails closed", async () => {
  for (const comparison of [
    { files: [file()] },
    { files: [file()], base_commit: { sha: headSha }, merge_base_commit: { sha: mergeBaseSha } },
    { files: [file()], base_commit: { sha: baseSha }, merge_base_commit: { sha: "bad" } },
  ]) {
    globalThis.fetch = async (input) => Response.json(String(input).endsWith("/pulls/7")
      ? { head: { sha: headSha }, base: { sha: baseSha, ref: "main" } }
      : comparison);
    const response = await GET(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
  }
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
