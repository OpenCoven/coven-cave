import assert from "node:assert/strict";
import {
  BRANCH_CAP,
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
  },
);

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
  assert.deepEqual(messages, ["Branch count 40/40; creation allowed."]);
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
  assert.deepEqual(messages, [
    "::error::Deleted 'feat/over-cap': repository branch cap 40 exceeded (41 branches).",
  ]);
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
