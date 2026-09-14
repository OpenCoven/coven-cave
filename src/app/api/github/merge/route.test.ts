// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "merge route should use the shared installation-agnostic token resolver",
);
assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "merge route should keep the owner/name barrier before path interpolation",
);
assert.match(source, /auth_required/, "merge is a write — it must 401 without a PAT");
assert.match(
  source,
  /typeof data\?\.message === "string" \? data\.message/,
  "merge passes GitHub's own error message through verbatim",
);
assert.doesNotMatch(source, /:\s*token\b/, "merge route must not return token material");
assert.match(
  source,
  /headRepo\.toLowerCase\(\) !== repo\.toLowerCase\(\)/,
  "branch cleanup must not delete a same-named base branch for a fork PR",
);

console.log("github-merge-route.test.ts OK");
assert.match(source, /new Set\(\["squash", "merge", "rebase"\]\)/, "merge methods are allow-listed");
assert.match(source, /data\.merged !== true/, "merge success requires GitHub's merged:true");

const home = mkdtempSync(join(tmpdir(), "cave-merge-head-"));
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = join(home, "cave");
process.env.GITHUB_PAT = "test-only-never-dispatched";
const realFetch = globalThis.fetch;
const { POST } = await import("./route.ts");
test.after(() => {
  globalThis.fetch = realFetch;
  rmSync(home, { recursive: true, force: true });
});

test("the reviewed head is forwarded to GitHub's atomic merge guard", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ merged: true, sha: "b".repeat(40) });
  };
  const headSha = "a".repeat(40);
  const result = await POST(new Request("http://localhost/api/github/merge", {
    method: "POST", body: JSON.stringify({ repo: "o/r", number: 7, method: "squash", headSha }),
  }));
  assert.equal((await result.json()).ok, true);
  assert.deepEqual(calls, [{
    url: "https://api.github.com/repos/o/r/pulls/7/merge",
    body: { merge_method: "squash", sha: headSha },
  }]);
});

test("a malformed explicit head never dispatches, while legacy callers can omit it", async () => {
  const payloads: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ merged: true });
  };
  for (const headSha of [null, "", "not-a-sha", 123]) {
    const result = await POST(new Request("http://localhost/api/github/merge", {
      method: "POST", body: JSON.stringify({ repo: "o/r", number: 7, headSha }),
    }));
    assert.equal(result.status, 400);
  }
  assert.deepEqual(payloads, []);
  const legacy = await POST(new Request("http://localhost/api/github/merge", {
    method: "POST", body: JSON.stringify({ repo: "o/r", number: 7 }),
  }));
  assert.equal((await legacy.json()).ok, true);
  assert.deepEqual(payloads, [{ merge_method: "squash" }]);
});

test("GitHub's changed-head refusal remains a failure with the actionable explanation", async () => {
  globalThis.fetch = async () => Response.json({ message: "Head branch was modified. Review the new head before merging." }, { status: 409 });
  const result = await POST(new Request("http://localhost/api/github/merge", {
    method: "POST", body: JSON.stringify({ repo: "o/r", number: 7, headSha: "a".repeat(40) }),
  }));
  const body = await result.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /Head branch was modified/);
});
