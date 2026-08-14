import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BRANCH_CAP,
  NEAR_CAP_HEADROOM,
  decideBranchCap,
  encodeBranchRef,
  runBranchCap,
} from "./enforce-branch-cap.mjs";

assert.equal(BRANCH_CAP, 40, "the repository cap stays explicit and reviewable");

assert.deepEqual(
  decideBranchCap({
    branchCount: 40,
    createdBranch: "feat/allowed",
    defaultBranch: "main",
  }),
  {
    action: "allow",
    branchCount: 40,
    maxBranches: 40,
    headroom: 0,
    nearCap: true,
  },
  "the last admissible branch is still allowed, but it is the one most worth warning about",
);

// The warning has to arrive while there is still room to act on it.
assert.deepEqual(
  decideBranchCap({ branchCount: 37, createdBranch: "feat/x", defaultBranch: "main" }),
  { action: "allow", branchCount: 37, maxBranches: 40, headroom: 3, nearCap: true },
);
assert.deepEqual(
  decideBranchCap({ branchCount: 36, createdBranch: "feat/x", defaultBranch: "main" }),
  { action: "allow", branchCount: 36, maxBranches: 40, headroom: 4, nearCap: false },
  "comfortable headroom stays quiet — a warning on every creation would be ignored by the time it mattered",
);
assert.equal(NEAR_CAP_HEADROOM, 3, "the warning threshold stays explicit and reviewable");

assert.deepEqual(
  decideBranchCap({
    branchCount: 41,
    createdBranch: "feat/over-cap",
    defaultBranch: "main",
  }),
  {
    action: "delete-created",
    branchCount: 41,
    maxBranches: 40,
    branch: "feat/over-cap",
  },
);

assert.deepEqual(
  decideBranchCap({
    branchCount: 41,
    createdBranch: "main",
    defaultBranch: "main",
  }),
  {
    action: "refuse-default",
    branchCount: 41,
    maxBranches: 40,
    branch: "main",
  },
);

assert.equal(
  encodeBranchRef("feat/slash#safe"),
  "heads%2Ffeat%2Fslash%23safe",
  "branch refs are encoded as one API path parameter",
);

{
  const calls = [];
  const messages = [];
  const status = await runBranchCap({
    env: {
      CREATED_BRANCH: "feat/allowed",
      DEFAULT_BRANCH: "main",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: "OpenCoven/coven-cave",
      GITHUB_TOKEN: "test-token",
      MAX_BRANCHES: "40",
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(Array.from({ length: 40 }, (_, index) => ({ name: `branch-${index}` })));
    },
    log: (message) => messages.push(message),
    error: (message) => messages.push(message),
  });

  assert.equal(status, 0);
  assert.equal(calls.length, 1, "an allowed branch only lists repository branches");
  assert.match(calls[0].url, /branches\?per_page=100$/);
  assert.equal(calls[0].options.headers.authorization, "Bearer test-token");
  assert.equal(messages[0], "Branch count 40/40; creation allowed.");
  // At the cap the creation succeeds, so nothing else would tell the session it
  // is one branch from a silent rollback.
  assert.match(messages[1], /^::warning::Branch cap: 40\/40 — 0 creations of headroom left\./);
  assert.match(messages[1], /is DELETED automatically/);
  assert.match(messages[1], /pnpm wt:status/, "the warning names the way out, not just the problem");
  assert.equal(messages.length, 2);
}

// A comfortable count says nothing beyond the count itself.
{
  const messages = [];
  const status = await runBranchCap({
    env: {
      CREATED_BRANCH: "feat/roomy",
      DEFAULT_BRANCH: "main",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: "OpenCoven/coven-cave",
      GITHUB_TOKEN: "test-token",
      MAX_BRANCHES: "40",
    },
    fetchImpl: async () =>
      jsonResponse(Array.from({ length: 20 }, (_, index) => ({ name: `branch-${index}` }))),
    log: (message) => messages.push(message),
    error: (message) => messages.push(message),
  });

  assert.equal(status, 0);
  assert.deepEqual(messages, ["Branch count 20/40; creation allowed."]);
}

{
  const calls = [];
  const messages = [];
  const status = await runBranchCap({
    env: {
      CREATED_BRANCH: "feat/over-cap",
      DEFAULT_BRANCH: "main",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: "OpenCoven/coven-cave",
      GITHUB_TOKEN: "test-token",
      MAX_BRANCHES: "40",
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "DELETE") return emptyResponse(204);
      return jsonResponse(Array.from({ length: 41 }, (_, index) => ({ name: `branch-${index}` })));
    },
    log: (message) => messages.push(message),
    error: (message) => messages.push(message),
  });

  assert.equal(status, 1, "rolling back an over-cap branch stays visible as a failed workflow");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "DELETE");
  assert.match(calls[1].url, /git\/refs\/heads%2Ffeat%2Fover-cap$/);
  // The message is the whole point of cave-iy3l7: a session that loses a branch
  // must not have to know branch-cap.yml exists to explain it. Assert the three
  // things it has to carry — what happened, that the work survives, what to do.
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^::error::Deleted the remote branch 'feat\/over-cap'/);
  assert.match(messages[0], /40-branch cap \(41 branches\)/, "names the cap and the count");
  assert.match(messages[0], /commits are NOT lost/, "leads with the part that stops the panic");
  assert.match(messages[0], /deletion is remote-only/, "and says why: the local branch still holds them");
  assert.match(messages[0], /retention\/<branch>-<sha>/, "points at the archived head");
  assert.match(messages[0], /then push the branch again/, "and ends with the recovery");
}

// The run summary carries the same message: an annotation under a collapsed
// step is easy to miss, and this workflow's whole failure mode is "nobody knew
// why".
{
  const dir = mkdtempSync(path.join(tmpdir(), "branch-cap-summary-"));
  const summaryPath = path.join(dir, "summary.md");
  try {
    const status = await runBranchCap({
      env: {
        CREATED_BRANCH: "feat/over-cap",
        DEFAULT_BRANCH: "main",
        GITHUB_API_URL: "https://api.github.test",
        GITHUB_REPOSITORY: "OpenCoven/coven-cave",
        GITHUB_TOKEN: "test-token",
        GITHUB_STEP_SUMMARY: summaryPath,
        MAX_BRANCHES: "40",
      },
      fetchImpl: async (url, options = {}) => {
        if (options.method === "DELETE") return emptyResponse(204);
        return jsonResponse(Array.from({ length: 41 }, (_, index) => ({ name: `branch-${index}` })));
      },
      log: () => {},
      error: () => {},
    });
    assert.equal(status, 1);
    const summary = readFileSync(summaryPath, "utf8");
    assert.match(summary, /Deleted the remote branch 'feat\/over-cap'/);
    assert.match(summary, /commits are NOT lost/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// An unwritable summary path must never change the enforcement outcome.
{
  const messages = [];
  const status = await runBranchCap({
    env: {
      CREATED_BRANCH: "feat/over-cap",
      DEFAULT_BRANCH: "main",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: "OpenCoven/coven-cave",
      GITHUB_TOKEN: "test-token",
      GITHUB_STEP_SUMMARY: path.join(tmpdir(), "no-such-dir-branch-cap", "summary.md"),
      MAX_BRANCHES: "40",
    },
    fetchImpl: async (url, options = {}) => {
      if (options.method === "DELETE") return emptyResponse(204);
      return jsonResponse(Array.from({ length: 41 }, (_, index) => ({ name: `branch-${index}` })));
    },
    log: (message) => messages.push(message),
    error: (message) => messages.push(message),
  });
  assert.equal(status, 1, "the rollback still reports as a failure");
  assert.match(messages[0], /Deleted the remote branch/, "and the annotation still carries the message");
}

// `per_page=100` makes the count a floor past 100 branches. The decision is
// unaffected (the cap tops out at 99) but the number must not read as fact.
{
  const messages = [];
  await runBranchCap({
    env: {
      CREATED_BRANCH: "feat/over-cap",
      DEFAULT_BRANCH: "main",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: "OpenCoven/coven-cave",
      GITHUB_TOKEN: "test-token",
      MAX_BRANCHES: "99",
    },
    fetchImpl: async (url, options = {}) => {
      if (options.method === "DELETE") return emptyResponse(204);
      return jsonResponse(Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}` })));
    },
    log: (message) => messages.push(message),
    error: (message) => messages.push(message),
  });
  assert.match(messages[0], /99-branch cap \(100\+ branches\)/, "a full page reports as a floor");
}

{
  const calls = [];
  await assert.rejects(
    runBranchCap({
      env: {
        CREATED_BRANCH: "main",
        DEFAULT_BRANCH: "main",
        GITHUB_API_URL: "https://api.github.test",
        GITHUB_REPOSITORY: "OpenCoven/coven-cave",
        GITHUB_TOKEN: "test-token",
        MAX_BRANCHES: "40",
      },
      fetchImpl: async (url, options = {}) => {
        calls.push({ url, options });
        return jsonResponse(Array.from({ length: 41 }, (_, index) => ({ name: `branch-${index}` })));
      },
      log: () => {},
      error: () => {},
    }),
    /refusing to delete the default branch 'main'/,
  );
  assert.equal(calls.length, 1, "the default branch is never sent to the deletion endpoint");
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value),
  };
}

function emptyResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => undefined,
    text: async () => "",
  };
}

console.log("enforce-branch-cap.test.mjs: ok");
