import assert from "node:assert/strict";
import { test } from "node:test";

import { TRACKING_LABEL, runMainHealth } from "./main-health.mjs";

const REPOSITORY = "OpenCoven/coven-cave";
const ENV = { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: REPOSITORY };

function sha(seed) {
  return String(seed).repeat(40).slice(0, 40);
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function commit({ id, subject, parents = 1, author = "Val Alexander" }) {
  return {
    sha: sha(id),
    parents: Array.from({ length: parents }, (_, index) => ({ sha: sha(`${id}${index}`) })),
    commit: {
      message: `${subject}\n\nbody`,
      author: { name: author },
      committer: { date: "2026-08-21T06:00:00Z" },
    },
  };
}

function run({ id = 1, headSha, conclusion = "success" }) {
  return {
    id,
    head_sha: headSha,
    conclusion,
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
  };
}

/**
 * A fake GitHub that records every mutation. Reads are matched by URL shape so
 * a test only has to describe the state it cares about.
 */
function github({ commits = [], runs = [], issues = [], pulls = {}, pullsStatus = 200 } = {}) {
  const mutations = [];
  let nextIssueNumber = 500;

  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;

    if (method !== "GET") {
      mutations.push({ method, path, body: JSON.parse(init.body) });
      if (/\/issues$/.test(path)) {
        nextIssueNumber += 1;
        return jsonResponse({
          number: nextIssueNumber,
          html_url: `https://github.com/${REPOSITORY}/issues/${nextIssueNumber}`,
        });
      }
      return jsonResponse({});
    }

    if (/\/commits\/[^/]+\/pulls$/.test(path)) {
      if (pullsStatus !== 200) return jsonResponse({ message: "unavailable" }, pullsStatus);
      const commitSha = path.split("/").at(-2);
      return jsonResponse(pulls[commitSha] ?? []);
    }
    if (/\/commits$/.test(path)) return jsonResponse(commits);
    if (/\/runs$/.test(path)) return jsonResponse({ workflow_runs: runs });
    if (/\/issues$/.test(path)) return jsonResponse(issues);

    throw new Error(`unexpected GET ${url}`);
  };

  return { fetchImpl, mutations };
}

function trackingIssue(number, culpritSha) {
  return {
    number,
    html_url: `https://github.com/${REPOSITORY}/issues/${number}`,
    body: `<!-- main-health:culprit=${culpritSha} -->\n\nmain is red.`,
  };
}

test("a green head reports green and files nothing", async () => {
  const { fetchImpl, mutations } = github({
    commits: [commit({ id: 1, subject: "feat: something (#4700)" })],
    runs: [run({ headSha: sha(1), conclusion: "success" })],
  });

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.status, "green");
  assert.deepEqual(mutations, []);
});

test("the culprit is the oldest failing commit in the streak, not the head", async () => {
  const commits = [
    commit({ id: 4, subject: "Merge branch 'fix/cave-frsmb-dev-sidecar-token'", parents: 2 }),
    commit({ id: 3, subject: "Merge branch 'feat/cave-20wrn-calm-streaming-chat'", parents: 2 }),
    commit({ id: 2, subject: "Merge branch 'fix/cave-atox4-marketplace-logo-colors'", parents: 2 }),
    commit({ id: 1, subject: "test: repair the stale contracts (#4768)" }),
  ];
  const { fetchImpl } = github({
    commits,
    runs: [
      run({ id: 4, headSha: sha(4), conclusion: "failure" }),
      run({ id: 3, headSha: sha(3), conclusion: "failure" }),
      run({ id: 2, headSha: sha(2), conclusion: "failure" }),
      run({ id: 1, headSha: sha(1), conclusion: "success" }),
    ],
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.status, "red");
  assert.equal(result.culprit.sha, sha(2));
  assert.equal(result.lastGood.sha, sha(1));
  assert.equal(result.culprit.landing.kind, "direct-merge");
  assert.equal(result.culprit.landing.branch, "fix/cave-atox4-marketplace-logo-colors");
});

test("a cancelled run neither blames nor clears its commit", async () => {
  // A push supersedes the previous run's concurrency group, so `main` cancels
  // healthy runs whenever pushes land back to back. Reading a cancellation as a
  // failure would blame whichever commit happened to be pushed over.
  const commits = [
    commit({ id: 3, subject: "Merge branch 'fix/late'", parents: 2 }),
    commit({ id: 2, subject: "Merge branch 'fix/cancelled'", parents: 2 }),
    commit({ id: 1, subject: "feat: green baseline (#4700)" }),
  ];
  const { fetchImpl } = github({
    commits,
    runs: [
      run({ id: 3, headSha: sha(3), conclusion: "failure" }),
      run({ id: 2, headSha: sha(2), conclusion: "cancelled" }),
      run({ id: 1, headSha: sha(1), conclusion: "success" }),
    ],
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.culprit.sha, sha(3), "the cancelled commit is not blamed");
  assert.deepEqual(
    result.unattributed.map((entry) => entry.sha),
    [sha(2)],
    "and it is reported rather than silently dropped",
  );
});

test("a squash-merged commit is credited to its pull request, not accused", async () => {
  const { fetchImpl } = github({
    commits: [commit({ id: 2, subject: "fix: a real regression (#4790)" })],
    runs: [run({ id: 2, headSha: sha(2), conclusion: "failure" })],
    pulls: {
      [sha(2)]: [{ number: 4790, merged_at: "2026-08-21T05:00:00Z", merge_commit_sha: sha(2) }],
    },
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.culprit.landing.kind, "pull-request");
  assert.equal(result.culprit.landing.pull, 4790);
});

test("an open pull request that merely contains the commit is not a landing", async () => {
  // `/commits/{sha}/pulls` lists every PR containing the commit, which includes
  // any branch cut from main afterwards. Only an exact merge_commit_sha match
  // on a merged PR proves how the commit itself landed.
  const { fetchImpl } = github({
    commits: [commit({ id: 2, subject: "Merge branch 'fix/local'", parents: 2 })],
    runs: [run({ id: 2, headSha: sha(2), conclusion: "failure" })],
    pulls: { [sha(2)]: [{ number: 4791, merged_at: null, merge_commit_sha: null }] },
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.culprit.landing.kind, "direct-merge");
  assert.equal(result.culprit.landing.branch, "fix/local");
});

test("an unavailable association is undetermined rather than a direct push", async () => {
  const { fetchImpl } = github({
    commits: [commit({ id: 2, subject: "Merge branch 'fix/local'", parents: 2 })],
    runs: [run({ id: 2, headSha: sha(2), conclusion: "failure" })],
    pullsStatus: 502,
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.culprit.landing.kind, "unknown");
  assert.equal(result.culprit.landing.reason, "association_unavailable_502");
});

test("report-only mode names the action it would take and mutates nothing", async () => {
  const { fetchImpl, mutations } = github({
    commits: [commit({ id: 2, subject: "Merge branch 'fix/local'", parents: 2 })],
    runs: [run({ id: 2, headSha: sha(2), conclusion: "failure" })],
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.deepEqual(mutations, []);
  assert.deepEqual(result.actions, [{ action: "open-issue", culprit: sha(2) }]);
});

test("apply files one labelled tracking issue naming the culprit", async () => {
  const { fetchImpl, mutations } = github({
    commits: [commit({ id: 2, subject: "Merge branch 'fix/cave-atox4-logos'", parents: 2 })],
    runs: [run({ id: 2, headSha: sha(2), conclusion: "failure" })],
  });

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.equal(mutations.length, 1);
  const [created] = mutations;
  assert.equal(created.method, "POST");
  assert.match(created.path, /\/issues$/);
  assert.deepEqual(created.body.labels, [TRACKING_LABEL]);
  assert.match(created.body.title, new RegExp(`^main is red since ${sha(2).slice(0, 9)} `));
  assert.match(created.body.body, new RegExp(`<!-- main-health:culprit=${sha(2)} -->`));
  assert.match(created.body.body, /pushed directly to the branch/);
  assert.match(created.body.body, /fix\/cave-atox4-logos/);
  assert.equal(result.actions[0].action, "open-issue");
});

test("a second red push while the issue is open does not file a duplicate", async () => {
  const { fetchImpl, mutations } = github({
    commits: [
      commit({ id: 3, subject: "Merge branch 'fix/later'", parents: 2 }),
      commit({ id: 2, subject: "Merge branch 'fix/first'", parents: 2 }),
      commit({ id: 1, subject: "feat: green baseline (#4700)" }),
    ],
    runs: [
      run({ id: 3, headSha: sha(3), conclusion: "failure" }),
      run({ id: 2, headSha: sha(2), conclusion: "failure" }),
      run({ id: 1, headSha: sha(1), conclusion: "success" }),
    ],
    issues: [trackingIssue(600, sha(2))],
  });

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.deepEqual(mutations, []);
  assert.deepEqual(result.actions, [
    { action: "none", reason: "already-tracked", issue: 600 },
  ]);
});

test("an earlier culprit retargets the open issue instead of opening another", async () => {
  const { fetchImpl, mutations } = github({
    commits: [
      commit({ id: 3, subject: "Merge branch 'fix/later'", parents: 2 }),
      commit({ id: 2, subject: "Merge branch 'fix/first'", parents: 2 }),
    ],
    runs: [
      run({ id: 3, headSha: sha(3), conclusion: "failure" }),
      run({ id: 2, headSha: sha(2), conclusion: "failure" }),
    ],
    issues: [trackingIssue(600, sha(3))],
  });

  await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.deepEqual(
    mutations.map((mutation) => `${mutation.method} ${mutation.path}`),
    [
      `POST /repos/${REPOSITORY}/issues/600/comments`,
      `PATCH /repos/${REPOSITORY}/issues/600`,
    ],
  );
  assert.match(mutations[1].body.body, new RegExp(`culprit=${sha(2)}`));
});

test("a recovered main closes the tracking issue", async () => {
  const { fetchImpl, mutations } = github({
    commits: [commit({ id: 3, subject: "fix: repair the merge (#4792)" })],
    runs: [run({ id: 3, headSha: sha(3), conclusion: "success" })],
    issues: [trackingIssue(600, sha(2))],
  });

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.deepEqual(result.actions, [{ action: "close-issue", issue: 600 }]);
  assert.equal(mutations.at(-1).body.state, "closed");
  assert.match(mutations[0].body.body, /green again/);
});

test("a head CI has not judged yet is unknown, and changes nothing", async () => {
  const { fetchImpl, mutations } = github({
    commits: [
      commit({ id: 3, subject: "Merge branch 'fix/just-pushed'", parents: 2 }),
      commit({ id: 2, subject: "feat: green baseline (#4700)" }),
    ],
    runs: [run({ id: 2, headSha: sha(2), conclusion: "success" })],
    issues: [trackingIssue(600, sha(1))],
  });

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.status, "unknown");
  assert.deepEqual(result.actions, [{ action: "none", reason: "no-verdict" }]);
  assert.deepEqual(mutations, [], "an open issue is not closed on the strength of no verdict");
});

test("a cancelled head is unknown, not green, and does not retract the issue", async () => {
  // Push churn on main cancels runs by design. Reading the head's cancellation
  // as a pass would close a tracking issue whose culprit is still on the branch.
  const { fetchImpl, mutations } = github({
    commits: [
      commit({ id: 3, subject: "Merge branch 'fix/pushed-over'", parents: 2 }),
      commit({ id: 2, subject: "Merge branch 'fix/first'", parents: 2 }),
    ],
    runs: [
      run({ id: 3, headSha: sha(3), conclusion: "cancelled" }),
      run({ id: 2, headSha: sha(2), conclusion: "failure" }),
    ],
    issues: [trackingIssue(600, sha(2))],
  });

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.status, "unknown");
  assert.deepEqual(mutations, []);
});

test("a missing label filter is no tracking issue rather than a crash", async () => {
  const commits = [commit({ id: 2, subject: "Merge branch 'fix/local'", parents: 2 })];
  const runs = [run({ id: 2, headSha: sha(2), conclusion: "failure" })];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if ((init.method ?? "GET") !== "GET") return jsonResponse({ number: 601 });
    if (/\/commits\/[^/]+\/pulls$/.test(path)) return jsonResponse([]);
    if (/\/commits$/.test(path)) return jsonResponse(commits);
    if (/\/runs$/.test(path)) return jsonResponse({ workflow_runs: runs });
    if (/\/issues$/.test(path)) return jsonResponse({ message: "Not Found" }, 404);
    throw new Error(`unexpected GET ${url}`);
  };

  const result = await runMainHealth({ apply: true, env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.tracking, null);
  assert.equal(result.actions[0].action, "open-issue");
});

test("the latest verdict for a head wins, so a re-run clears it", async () => {
  const { fetchImpl } = github({
    commits: [commit({ id: 2, subject: "fix: something (#4790)" })],
    runs: [
      run({ id: 20, headSha: sha(2), conclusion: "success" }),
      run({ id: 19, headSha: sha(2), conclusion: "failure" }),
    ],
  });

  const result = await runMainHealth({ env: ENV, fetchImpl, log: () => {} });

  assert.equal(result.status, "green");
});

test("a missing token fails loudly rather than scanning nothing", async () => {
  await assert.rejects(
    () => runMainHealth({ env: { GITHUB_REPOSITORY: REPOSITORY }, fetchImpl: async () => {} }),
    /GITHUB_TOKEN is required/,
  );
  await assert.rejects(
    () => runMainHealth({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "nope" }, fetchImpl: async () => {} }),
    /OWNER\/REPO/,
  );
});
