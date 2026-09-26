import assert from "node:assert/strict";
import { test } from "node:test";

const {
  claimIssue,
  closeIssue,
  createIssue,
  issueItemFromGraph,
  issueNumberFromId,
  priorityFromLabels,
  readIssue,
  readIssueQueue,
  setIssuePriority,
} = await import("./github-issue-queue.ts");

type Call = string[];

/** A fake `gh` that answers by the first matching rule and records every call. */
function fakeGh(rules: Array<[(args: string[]) => boolean, (args: string[]) => unknown]>) {
  const calls: Call[] = [];
  const run = async (_root: string, args: string[]) => {
    calls.push(args);
    for (const [match, answer] of rules) {
      if (match(args)) {
        const value = answer(args);
        if (value && typeof value === "object" && "ok" in (value as object)) return value as never;
        return { ok: true as const, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "" };
      }
    }
    return { ok: false as const, status: 502, error: `unexpected gh ${args.join(" ")}`, stdout: "", stderr: "" };
  };
  return { run, calls };
}

const repoView = (args: string[]) => args[0] === "repo" && args[1] === "view";
const graphql = (args: string[]) => args[0] === "api" && args[1] === "graphql";
// Each test uses its own root: the repository name is cached per root.
let rootSeq = 0;
const root = () => `/work/repo-${++rootSeq}`;

function node(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "OPEN",
    url: `https://github.com/OpenCoven/example/issues/${number}`,
    body: `Body ${number}`,
    updatedAt: "2026-09-01T00:00:00Z",
    repository: { nameWithOwner: "OpenCoven/example" },
    assignees: { nodes: [] },
    labels: { nodes: [] },
    comments: { totalCount: 0 },
    issueType: null,
    blockedBy: { nodes: [] },
    ...over,
  };
}

const labels = (...names: string[]) => ({ nodes: names.map((name) => ({ name })) });

test("priority comes from the highest P<n> label, and is null without one", () => {
  assert.equal(priorityFromLabels(["P3", "bug", "p1"]), 1);
  assert.equal(priorityFromLabels(["priority::high", "P9", "P"]), null);
  assert.equal(priorityFromLabels([]), null);
});

test("issue ids are this repository's numbers and nothing else", () => {
  assert.equal(issueNumberFromId("#12"), 12);
  assert.equal(issueNumberFromId(" 12 "), 12);
  for (const bad of ["#0", "cave-abc", "owner/repo#12", "#12a", "", "#1234567890"]) {
    assert.equal(issueNumberFromId(bad), null, bad);
  }
});

test("an issue maps to the queue's item shape with derived status and open blockers only", () => {
  const item = issueItemFromGraph(
    node(7, {
      labels: labels("P2", "familiar:kitty"),
      comments: { totalCount: 3 },
      issueType: { name: "Bug" },
      blockedBy: {
        nodes: [
          { number: 5, state: "OPEN", title: "Dep", url: "u5", repository: { nameWithOwner: "OpenCoven/example" } },
          { number: 6, state: "CLOSED", title: "Done dep", url: "u6", repository: { nameWithOwner: "OpenCoven/example" } },
          { number: 9, state: "OPEN", title: "Upstream", url: "u9", repository: { nameWithOwner: "OpenCoven/other" } },
        ],
      },
    }),
    "OpenCoven/example",
  );
  assert.deepEqual(item, {
    id: "#7",
    number: 7,
    title: "Issue 7",
    status: "in_progress",
    priority: 2,
    assignee: null,
    labels: ["P2", "familiar:kitty"],
    updated_at: "2026-09-01T00:00:00Z",
    comment_count: 3,
    description: "Body 7",
    url: "https://github.com/OpenCoven/example/issues/7",
    issue_type: "Bug",
    blocked_by: ["#5", "OpenCoven/other#9"],
    blocked_by_count: 2,
  });
  assert.equal(issueItemFromGraph(node(8), "OpenCoven/example")?.status, "open", "unclaimed is open");
  assert.equal(
    issueItemFromGraph(node(8, { assignees: { nodes: [{ login: "val" }] } }), "OpenCoven/example")?.status,
    "in_progress",
    "an assignee claims it",
  );
  assert.equal(issueItemFromGraph({ title: "no number" }, "OpenCoven/example"), null);
});

test("the queue splits open issues into ready and blocked and names each blocker once", async () => {
  const blocker = { number: 1, state: "OPEN", title: "Land the API", url: "u1", repository: { nameWithOwner: "OpenCoven/example" }, labels: labels("P0") };
  const pages = [
    { hasNextPage: true, endCursor: "c1", nodes: [node(1, { labels: labels("P0") }), node(2, { blockedBy: { nodes: [blocker] } })] },
    { hasNextPage: false, endCursor: null, nodes: [node(3, { blockedBy: { nodes: [blocker] } })] },
  ];
  const gh = fakeGh([
    [repoView, () => "OpenCoven/example\n"],
    [graphql, (args) => {
      const page = args.includes("after=c1") ? pages[1] : pages[0];
      return { data: { repository: { issues: { pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor }, nodes: page.nodes } } } };
    }],
  ]);
  const result = await readIssueQueue(root(), gh.run);
  assert.ok(result.ok);
  assert.equal(result.snapshot.repository, "OpenCoven/example");
  assert.deepEqual(result.snapshot.ready.map((item) => item.id), ["#1"]);
  assert.deepEqual(result.snapshot.blocked.map((item) => item.id), ["#2", "#3"]);
  assert.deepEqual(result.snapshot.blockers, [{ id: "#1", title: "Land the API", status: "open", priority: 0, url: "u1" }]);
  assert.equal(gh.calls.filter(graphql).length, 2, "follows the cursor across pages");
  const query = gh.calls.find(graphql)!;
  assert.ok(query.includes("owner=OpenCoven") && query.includes("name=example"), "queries the remote's repository");
});

test("a missing gh or repository surfaces as a failed read, not an empty queue", async () => {
  const noGh = await readIssueQueue(root(), async () => ({ ok: false, status: 503, error: "gh unavailable", stdout: "", stderr: "" }));
  assert.equal(noGh.ok, false);
  assert.equal(!noGh.ok && noGh.status, 503);
  const odd = await readIssueQueue(root(), fakeGh([[repoView, () => "not a repo"]]).run);
  assert.equal(!odd.ok && odd.error, "gh did not report a GitHub repository");
  const shape = await readIssueQueue(root(), fakeGh([[repoView, () => "o/r"], [graphql, () => ({ data: { repository: null } })]]).run);
  assert.equal(!shape.ok && shape.error, "gh returned an unexpected issue list");
});

test("show reads one issue and reports a missing one as 404", async () => {
  const gh = fakeGh([
    [repoView, () => "OpenCoven/example"],
    [graphql, (args) => (args.includes("number=4") ? { data: { repository: { issue: node(4) } } } : { data: { repository: { issue: null } } })],
  ]);
  const r = root();
  const shown = await readIssue(r, 4, gh.run);
  assert.ok(shown.ok && shown.item.id === "#4");
  const missing = await readIssue(r, 5, gh.run);
  assert.equal(!missing.ok && missing.status, 404);
});

test("setting a priority replaces every other P<n> label, and null clears it", async () => {
  const gh = fakeGh([[(args) => args[0] === "issue" && args[1] === "edit", () => ""]]);
  await setIssuePriority("/r", 9, 1, ["P3", "bug", "p4"], gh.run);
  assert.deepEqual(gh.calls[0], ["issue", "edit", "9", "--add-label", "P1", "--remove-label", "P3", "--remove-label", "p4"]);
  await setIssuePriority("/r", 9, null, ["P1", "bug"], gh.run);
  assert.deepEqual(gh.calls[1], ["issue", "edit", "9", "--remove-label", "P1"]);
  const before = gh.calls.length;
  await setIssuePriority("/r", 9, null, ["bug"], gh.run);
  assert.equal(gh.calls.length, before, "nothing to change sends nothing");
});

test("a missing label is created once and the edit retried", async () => {
  let edits = 0;
  const gh = fakeGh([
    [(args) => args[1] === "edit", () => {
      edits += 1;
      return edits === 1
        ? { ok: false, status: 502, error: "could not add label: 'P0' not found", stdout: "", stderr: "" }
        : "";
    }],
    [(args) => args[0] === "label" && args[1] === "create", () => ""],
  ]);
  const result = await setIssuePriority("/r", 3, 0, [], gh.run);
  assert.ok(result.ok);
  assert.deepEqual(gh.calls.map((call) => call.slice(0, 3).join(" ")), ["issue edit 3", "label create P0", "issue edit 3"]);
  assert.ok(!gh.calls[1].includes("--force"), "an existing label is never recolored");
});

test("claim assigns the connected user and names the familiar through its label", async () => {
  const gh = fakeGh([[(args) => args[1] === "edit", () => ""]]);
  await claimIssue("/r", 4, null, [], gh.run);
  assert.deepEqual(gh.calls, [["issue", "edit", "4", "--add-assignee", "@me"]], "a bare claim only assigns");
  gh.calls.length = 0;
  await claimIssue("/r", 4, "nova", ["familiar:kitty", "P2"], gh.run);
  assert.deepEqual(gh.calls, [
    ["issue", "edit", "4", "--add-assignee", "@me"],
    ["issue", "edit", "4", "--add-label", "familiar:nova", "--remove-label", "familiar:kitty"],
  ]);
  gh.calls.length = 0;
  await claimIssue("/r", 4, "nova", ["familiar:nova"], gh.run);
  assert.equal(gh.calls.length, 1, "an already-named familiar needs no label write");
});

test("close completes the issue with its reason as the closing comment", async () => {
  const gh = fakeGh([[(args) => args[1] === "close", () => ""]]);
  await closeIssue("/r", 11, "Verified in #42", gh.run);
  assert.deepEqual(gh.calls[0], ["issue", "close", "11", "--reason", "completed", "--comment", "Verified in #42"]);
});

test("create returns the new issue number from gh's printed URL", async () => {
  const gh = fakeGh([[(args) => args[1] === "create", () => "Creating issue in OpenCoven/example\n\nhttps://github.com/OpenCoven/example/issues/123\n"]]);
  const created = await createIssue("/r", { title: "From PR", body: "Filed from unlinked PR #9", labels: ["from-pr"] }, gh.run);
  assert.deepEqual(created, { ok: true, number: 123, url: "https://github.com/OpenCoven/example/issues/123" });
  assert.deepEqual(gh.calls[0], ["issue", "create", "--title", "From PR", "--body", "Filed from unlinked PR #9", "--label", "from-pr"]);
  const garbled = await createIssue("/r", { title: "x", body: "", labels: [] }, fakeGh([[() => true, () => "done"]]).run);
  assert.equal(!garbled.ok && garbled.error, "gh did not report the new issue URL");
});
