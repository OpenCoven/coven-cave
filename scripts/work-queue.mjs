#!/usr/bin/env node
// The work queue, read from GitHub Issues.
//
//   pnpm work:queue [--ready] [--lane <lane>] [--state <state>] [--json]
//   pnpm work:lint
//   pnpm work:propose [--overrides <file>] [--out <file>] [--table]
//   pnpm work:apply <manifest.json> [--apply] [--include-closures]
//
// Every open issue carries one `lane:*` label, one `state:*` label (epics
// carry none), and a compact `cave-work:v1` block at the top of its body. The
// labels make the queue filterable; the block names the owner, the unit and
// one imperative next step. See docs/workflows/github-work-tracking.md.
//
// `apply` is a dry run unless `--apply` is passed, re-reads each issue before
// writing, and skips any issue that changed after its manifest was generated.
// It never closes an issue without `--include-closures`.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_REPOSITORY = "OpenCoven/coven-cave";
export const LANES = ["mvp", "authority", "native", "release", "reliability", "core-ux"];
export const STATES = ["ready", "in-progress", "in-review", "blocked", "needs-owner", "needs-device", "parked"];
// A claim label cannot prove a session is still alive, so lint asks after this long.
const CLAIM_STALE_DAYS = 7;

const BLOCK_START = "<!-- cave-work:v1:start -->";
const BLOCK_END = "<!-- cave-work:v1:end -->";
const BLOCK = /<!-- cave-work:v1:start -->\n([\s\S]*?)\n<!-- cave-work:v1:end -->/;
const GOALS = /<!-- cave-goals:[^>]*:start -->[\s\S]*?<!-- cave-goals:[^>]*:end -->/;
const ARCHIVE_MARKER = "<!-- cave-goals-archive -->";
const FIELDS = ["lane", "state", "owner", "unit", "blocked-by", "clears-when", "next", "updated"];
const EMPTY = "—";
// The 5 November goals blocks named lanes in prose; this is their label form.
const PROSE_LANES = new Map([["retained core ux", "core-ux"]]);

export function parseWorkBlock(body) {
  const match = BLOCK.exec(body ?? "");
  if (!match) return null;
  const block = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const value = line.slice(colon + 1).trim();
    block[line.slice(0, colon).trim()] = value === EMPTY || value === "-" ? "" : value;
  }
  return block;
}

export function renderWorkBlock(fields) {
  const lines = FIELDS.filter((key) => key !== "state" || fields.state).map(
    (key) => `${key}: ${oneLine(fields[key]) || EMPTY}`,
  );
  return [BLOCK_START, ...lines, BLOCK_END].join("\n");
}

// Puts `block` at the top of an issue body. A previous work block is replaced
// in place; a 5 November goals block is replaced and returned as `removed` so
// the caller can archive it; a body with neither gets the block prepended.
export function replaceLeadBlock(body, block) {
  const text = body ?? "";
  if (BLOCK.test(text)) return { body: text.replace(BLOCK, () => block), removed: null };
  const goals = GOALS.exec(text);
  if (goals) return { body: text.replace(GOALS, () => block), removed: goals[0] };
  return { body: `${block}\n\n${text}`, removed: null };
}

export function bodyDigest(body) {
  return createHash("sha256").update(body ?? "").digest("hex");
}

export function lintIssue(issue, { openPulls, today = new Date().toISOString().slice(0, 10) } = {}) {
  const problems = [];
  const lanes = labelValues(issue, "lane:");
  const states = labelValues(issue, "state:");
  const epic = issue.labels.includes("epic");
  if (lanes.length !== 1) problems.push(`needs exactly one lane:* label (has ${lanes.length})`);
  if (epic ? states.length > 1 : states.length !== 1) {
    problems.push(`needs exactly one state:* label (has ${states.length})`);
  }
  for (const label of issue.labels.filter((name) => name.startsWith("workflow:"))) {
    problems.push(`carries the retired label ${label}`);
  }

  const block = parseWorkBlock(issue.body);
  if (!block) return [...problems, "has no cave-work:v1 block"];
  if (lanes.length === 1 && block.lane !== lanes[0]) {
    problems.push(`block says lane ${block.lane || "(none)"}, label says ${lanes[0]}`);
  }
  if (states.length === 1 && block.state !== states[0]) {
    problems.push(`block says state ${block.state || "(none)"}, label says ${states[0]}`);
  }
  for (const field of ["owner", "next", "updated"]) {
    if (!block[field]) problems.push(`block is missing ${field}`);
  }

  const native = issue.blockedBy.map((blocker) => blocker.number).sort(byNumber);
  const named = issueNumbers(block["blocked-by"]);
  if (native.join() !== named.join()) {
    problems.push(`block blocked-by (${refs(named)}) does not match the native links (${refs(native)})`);
  }
  const open = openBlockers(issue);
  const state = states.length === 1 ? states[0] : null;
  if (state === "blocked" && open.length === 0 && !block["clears-when"]) {
    problems.push("state:blocked needs an open blocked-by link or a clears-when condition");
  }
  if (state === "ready" && open.length > 0) {
    problems.push(`state:ready has open blocker ${refs(open)}`);
  }
  if (state === "in-progress" && daysBetween(block.updated, today) > CLAIM_STALE_DAYS) {
    problems.push(`state:in-progress since ${block.updated}; confirm the session is live, or restore the real state`);
  }
  if (state === "in-review" && openPulls) {
    const pulls = [...(block.unit ?? "").matchAll(/PR #(\d+)/g)].map((match) => Number(match[1]));
    if (!pulls.some((number) => openPulls.has(number))) {
      problems.push("state:in-review needs an open pull request named in unit, as `PR #<number>`");
    }
  }
  return problems;
}

export function queueRows(issues, { ready = false, lane, state } = {}) {
  return issues
    .map((issue) => {
      const block = parseWorkBlock(issue.body) ?? {};
      return {
        number: issue.number,
        title: issue.title,
        epic: issue.labels.includes("epic"),
        lane: labelValues(issue, "lane:")[0] ?? "",
        state: labelValues(issue, "state:")[0] ?? "",
        parent: issue.parent ?? null,
        blockers: openBlockers(issue),
        owner: block.owner ?? "",
        next: block.next ?? "",
      };
    })
    .filter((row) => !lane || row.lane === lane)
    .filter((row) => !state || row.state === state)
    .filter((row) => !ready || (row.state === "ready" && row.blockers.length === 0 && !row.epic))
    .sort((a, b) => a.number - b.number);
}

// One manifest entry: what this issue's labels, block and links should become.
// Values an override does not supply are carried over from the issue itself.
export function proposeEntry(issue, overrides = {}, { today }) {
  const block = parseWorkBlock(issue.body) ?? {};
  const epic = overrides.epic === true || issue.labels.includes("epic");
  const lane = overrides.lane ?? labelValues(issue, "lane:")[0] ?? block.lane ?? proseLane(issue.body) ?? "";
  const state = epic ? "" : (overrides.state ?? labelValues(issue, "state:")[0] ?? block.state ?? "");
  const blockedBy = [...(overrides.blockedBy ?? issue.blockedBy.map((blocker) => blocker.number))].sort(byNumber);

  const wanted = [epic && "epic", lane && `lane:${lane}`, state && `state:${state}`].filter(Boolean);
  const stale = issue.labels.filter(
    (name) =>
      name.startsWith("workflow:") ||
      ((name.startsWith("lane:") || name.startsWith("state:")) && !wanted.includes(name)),
  );

  return {
    number: issue.number,
    title: issue.title,
    observed: { body: bodyDigest(issue.body), labels: [...issue.labels].sort(), comments: issue.comments },
    labels: { add: wanted.filter((name) => !issue.labels.includes(name)).sort(), remove: stale.sort() },
    block: {
      lane,
      ...(state ? { state } : {}),
      owner: overrides.owner ?? (issue.assignees.join(", ") || "unassigned"),
      unit: overrides.unit ?? block.unit ?? "",
      "blocked-by": refs(blockedBy, ""),
      "clears-when": overrides.clearsWhen ?? block["clears-when"] ?? "",
      next: overrides.next ?? block.next ?? proseField(issue.body, "Next step") ?? "",
      updated: today,
    },
    parent: overrides.parent ?? issue.parent ?? null,
    blockedBy,
    archiveGoals: GOALS.test(issue.body ?? ""),
    close: overrides.close ?? null,
    unresolved: [!lane && "lane", !epic && !state && "state"].filter(Boolean),
  };
}

// The writes still owed to `live` for one manifest entry, or the reason to
// leave it alone. Safe to re-run: steps already visible on the issue drop out.
export function planActions(entry, live, { includeClosures = false } = {}) {
  if (entry.unresolved.length > 0) return { skip: `unresolved: ${entry.unresolved.join(", ")}`, actions: [] };
  if (live.closed) return { skip: "already closed", actions: [] };

  const replaced = replaceLeadBlock(live.body, renderWorkBlock(entry.block));
  const ours = new Set([...entry.labels.add, ...entry.labels.remove]);
  const foreign = (labels) => labels.filter((name) => !ours.has(name)).sort().join();
  const bodyMoved = bodyDigest(live.body) !== entry.observed.body && live.body !== replaced.body;
  const commentsMoved = live.comments !== entry.observed.comments + (live.archived ? 1 : 0);
  if (bodyMoved || commentsMoved || foreign(live.labels) !== foreign(entry.observed.labels)) {
    return { skip: "changed since the manifest was generated", actions: [] };
  }

  const actions = [];
  const add = entry.labels.add.filter((name) => !live.labels.includes(name));
  const remove = entry.labels.remove.filter((name) => live.labels.includes(name));
  if (add.length > 0 || remove.length > 0) actions.push({ kind: "labels", add, remove });
  if (entry.archiveGoals && !live.archived && replaced.removed) {
    actions.push({ kind: "archive", body: archiveComment(replaced.removed) });
  }
  if (live.body !== replaced.body) actions.push({ kind: "body", body: replaced.body });
  if (entry.parent && !live.parent) actions.push({ kind: "parent", parent: entry.parent });
  const linked = new Set(live.blockedBy.map((blocker) => blocker.number));
  const blockers = entry.blockedBy.filter((number) => !linked.has(number));
  if (blockers.length > 0) actions.push({ kind: "blocked-by", blockers });
  if (includeClosures && entry.close) actions.push({ kind: "close", ...entry.close });

  const note = entry.parent && live.parent && live.parent !== entry.parent
    ? `keeps its existing parent #${live.parent}; #${entry.parent} was not applied`
    : null;
  return { skip: null, note, actions: actions.map((action) => ({ number: entry.number, ...action })) };
}

export async function applyManifest(context, manifest, { apply = false, includeClosures = false } = {}) {
  const report = [];
  for (const entry of manifest.issues) {
    const live = await context.fetchIssue(entry.number);
    const plan = planActions(entry, live, { includeClosures });
    const row = { number: entry.number, ...(plan.note ? { note: plan.note } : {}) };
    if (plan.skip) {
      report.push({ ...row, skipped: plan.skip });
    } else if (!apply) {
      report.push({ ...row, planned: plan.actions.map((action) => action.kind) });
    } else {
      row.done = [];
      for (const action of plan.actions) {
        try {
          await context.write(action);
          row.done.push(action.kind);
        } catch (error) {
          // Stop this issue at its first failure; a re-run resumes from here.
          row.failed = `${action.kind}: ${error.message}`;
          break;
        }
      }
      report.push(row);
    }
  }
  return report;
}

export function manifestTable(manifest) {
  const rows = manifest.issues.map((entry) =>
    [
      `#${entry.number}`,
      entry.block.lane || "?",
      entry.block.state || (entry.unresolved.includes("state") ? "?" : "epic"),
      entry.parent ? `#${entry.parent}` : EMPTY,
      refs(entry.blockedBy),
      cell(entry.block.next),
      entry.close ? `close (${entry.close.reason})` : EMPTY,
    ].join(" | "),
  );
  return [
    "| Issue | Lane | State | Parent | Blocked by | Next step | Close |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

function archiveComment(goals) {
  return [
    ARCHIVE_MARKER,
    "<details><summary>Archived goals block from 5 November 2026, replaced by the compact work block at the top of this issue</summary>",
    "",
    goals,
    "",
    "</details>",
  ].join("\n");
}

function labelValues(issue, prefix) {
  return issue.labels.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length));
}

function openBlockers(issue) {
  return issue.blockedBy.filter((blocker) => blocker.open).map((blocker) => blocker.number).sort(byNumber);
}

function issueNumbers(text) {
  return [...(text ?? "").matchAll(/#(\d+)/g)].map((match) => Number(match[1])).sort(byNumber);
}

function proseLane(body) {
  const lane = /\*\*Lane:\*\*\s*([^.\n]+)/.exec(body ?? "")?.[1].trim().toLowerCase();
  return lane ? (PROSE_LANES.get(lane) ?? lane) : null;
}

function proseField(body, name) {
  return new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]+)`).exec(body ?? "")?.[1].trim() ?? null;
}

function refs(numbers, empty = EMPTY) {
  return numbers.length > 0 ? numbers.map((number) => `#${number}`).join(", ") : empty;
}

function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cell(value) {
  const text = oneLine(value).replaceAll("|", "\\|");
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

function daysBetween(from, to) {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function byNumber(a, b) {
  return a - b;
}

// ---------------------------------------------------------------------------
// GitHub access, through the `gh` CLI and the caller's own authentication.

const ISSUE_FIELDS = `number title body state
  labels(first: 50) { nodes { name } }
  assignees(first: 10) { nodes { login } }
  parent { number }
  subIssues { totalCount }
  blockedBy(first: 50) { nodes { number state } }`;

const RATE_LIMITED = /rate limit/i;
const RETRY_WAITS_MS = [30_000, 60_000, 120_000];

// GitHub's secondary rate limit is shared by every session on the account and
// clears on its own. Wait it out instead of failing a half-applied manifest.
// Any failure is rethrown as gh's own message, without the echoed command.
export function retryRateLimited(run, { sleep = sleepSync } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return run();
    } catch (error) {
      const message = String(error.stderr ?? "").trim() || error.message;
      if (!RATE_LIMITED.test(message) || attempt >= RETRY_WAITS_MS.length) throw new Error(message);
      sleep(RETRY_WAITS_MS[attempt]);
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function gh(args) {
  return retryRateLimited(() =>
    execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }),
  );
}

function graphql(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    if (value !== null && value !== undefined) args.push(typeof value === "number" ? "-F" : "-f", `${name}=${value}`);
  }
  return JSON.parse(gh(args)).data;
}

function normalize(node) {
  return {
    number: node.number,
    title: node.title,
    body: node.body ?? "",
    closed: node.state === "CLOSED",
    labels: node.labels.nodes.map((label) => label.name),
    assignees: node.assignees.nodes.map((user) => user.login),
    comments: node.comments.totalCount,
    archived: (node.comments.nodes ?? []).some((comment) => comment.body.includes(ARCHIVE_MARKER)),
    parent: node.parent?.number ?? null,
    subIssues: node.subIssues.totalCount,
    blockedBy: node.blockedBy.nodes.map((blocker) => ({ number: blocker.number, open: blocker.state === "OPEN" })),
  };
}

function split(repository) {
  const [owner, name] = repository.split("/");
  if (!owner || !name) throw new Error(`repository must be owner/name, got "${repository}"`);
  return { owner, name };
}

export function createGitHub(repository = DEFAULT_REPOSITORY) {
  const { owner, name } = split(repository);
  const databaseId = (number) => gh(["api", `repos/${repository}/issues/${number}`, "--jq", ".id"]).trim();
  const withFile = (body, run) => {
    const dir = mkdtempSync(path.join(tmpdir(), "work-queue-"));
    try {
      const file = path.join(dir, "body.md");
      writeFileSync(file, body);
      return run(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  return {
    fetchOpenIssues() {
      const issues = [];
      for (let after = null; ; ) {
        const page = graphql(
          `query($owner: String!, $name: String!, $after: String) {
            repository(owner: $owner, name: $name) {
              issues(states: OPEN, first: 50, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes { ${ISSUE_FIELDS} comments { totalCount } }
              }
            }
          }`,
          { owner, name, after },
        ).repository.issues;
        issues.push(...page.nodes.map(normalize));
        if (!page.pageInfo.hasNextPage) return issues.sort((a, b) => a.number - b.number);
        after = page.pageInfo.endCursor;
      }
    },
    fetchOpenPulls() {
      const pulls = new Set();
      for (let after = null; ; ) {
        const page = graphql(
          `query($owner: String!, $name: String!, $after: String) {
            repository(owner: $owner, name: $name) {
              pullRequests(states: OPEN, first: 100, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes { number }
              }
            }
          }`,
          { owner, name, after },
        ).repository.pullRequests;
        for (const pull of page.nodes) pulls.add(pull.number);
        if (!page.pageInfo.hasNextPage) return pulls;
        after = page.pageInfo.endCursor;
      }
    },
    async fetchIssue(number) {
      // The newest comments are enough to see this tool's own archive comment.
      const data = graphql(
        `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            issue(number: $number) { ${ISSUE_FIELDS} comments(last: 20) { totalCount nodes { body } } }
          }
        }`,
        { owner, name, number },
      );
      return normalize(data.repository.issue);
    },
    async write(action) {
      const issue = String(action.number);
      if (action.kind === "labels") {
        const args = ["issue", "edit", issue, "--repo", repository];
        if (action.add.length > 0) args.push("--add-label", action.add.join(","));
        if (action.remove.length > 0) args.push("--remove-label", action.remove.join(","));
        gh(args);
      } else if (action.kind === "archive") {
        withFile(action.body, (file) => gh(["issue", "comment", issue, "--repo", repository, "--body-file", file]));
      } else if (action.kind === "body") {
        withFile(action.body, (file) => gh(["issue", "edit", issue, "--repo", repository, "--body-file", file]));
      } else if (action.kind === "parent") {
        gh(["api", "-X", "POST", `repos/${repository}/issues/${action.parent}/sub_issues`, "-F", `sub_issue_id=${databaseId(action.number)}`]);
      } else if (action.kind === "blocked-by") {
        for (const blocker of action.blockers) {
          gh(["api", "-X", "POST", `repos/${repository}/issues/${issue}/dependencies/blocked_by`, "-F", `issue_id=${databaseId(blocker)}`]);
        }
      } else if (action.kind === "close") {
        gh(["issue", "close", issue, "--repo", repository, "--reason", action.reason, "--comment", action.comment]);
      } else {
        throw new Error(`unknown action ${action.kind}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Command line.

function parseArgs(argv) {
  const options = { command: "list", positional: [] };
  const flags = new Set(["--ready", "--json", "--table", "--apply", "--include-closures"]);
  const values = new Set(["--lane", "--state", "--overrides", "--out", "--repo"]);
  const args = [...argv];
  if (args[0] && !args[0].startsWith("--")) options.command = args.shift();
  while (args.length > 0) {
    const arg = args.shift();
    if (flags.has(arg)) options[camel(arg)] = true;
    else if (values.has(arg)) {
      if (args.length === 0) throw new Error(`${arg} needs a value`);
      options[camel(arg)] = args.shift();
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

function camel(flag) {
  return flag.slice(2).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
}

function printQueue(rows, log) {
  if (rows.length === 0) return log("No matching open issues.");
  for (const lane of [...LANES, ""]) {
    const inLane = rows.filter((row) => row.lane === lane);
    if (inLane.length === 0) continue;
    log(`\n${lane ? `lane:${lane}` : "no lane"} (${inLane.length})`);
    for (const row of inLane) {
      const tags = [row.epic ? "epic" : row.state || "no state", row.parent && `under #${row.parent}`, row.blockers.length > 0 && `blocked by ${refs(row.blockers)}`];
      log(`  #${row.number}  [${tags.filter(Boolean).join(", ")}]  ${row.title}`);
      if (row.next) log(`         next: ${row.next}`);
    }
  }
}

export async function main(argv, { log = console.log, github } = {}) {
  const options = parseArgs(argv);
  const api = github ?? createGitHub(options.repo);

  if (options.command === "list") {
    const rows = queueRows(api.fetchOpenIssues(), options);
    if (options.json) log(JSON.stringify(rows, null, 2));
    else printQueue(rows, log);
    return 0;
  }

  if (options.command === "lint") {
    const issues = api.fetchOpenIssues();
    const openPulls = api.fetchOpenPulls();
    let failing = 0;
    for (const issue of issues) {
      const problems = lintIssue(issue, { openPulls });
      if (problems.length === 0) continue;
      failing += 1;
      log(`#${issue.number} ${issue.title}`);
      for (const problem of problems) log(`  - ${problem}`);
    }
    log(failing === 0 ? `All ${issues.length} open issues pass.` : `\n${failing} of ${issues.length} open issues need attention.`);
    return failing === 0 ? 0 : 1;
  }

  if (options.command === "propose") {
    const overrides = options.overrides ? JSON.parse(readFileSync(options.overrides, "utf8")) : {};
    const today = new Date().toISOString().slice(0, 10);
    const manifest = {
      repository: options.repo ?? DEFAULT_REPOSITORY,
      generated: new Date().toISOString(),
      issues: api.fetchOpenIssues().map((issue) => proposeEntry(issue, overrides[issue.number] ?? {}, { today })),
    };
    const output = options.table ? manifestTable(manifest) : JSON.stringify(manifest, null, 2);
    if (options.out) writeFileSync(options.out, `${output}\n`);
    else log(output);
    const unresolved = manifest.issues.filter((entry) => entry.unresolved.length > 0);
    if (unresolved.length > 0) console.error(`${unresolved.length} issue(s) still need a lane or state: ${refs(unresolved.map((entry) => entry.number))}`);
    return 0;
  }

  if (options.command === "apply") {
    if (options.positional.length !== 1) throw new Error("apply needs one manifest file");
    const manifest = JSON.parse(readFileSync(options.positional[0], "utf8"));
    const report = await applyManifest(api, manifest, { apply: Boolean(options.apply), includeClosures: Boolean(options.includeClosures) });
    for (const row of report) {
      const outcome = row.skipped ? `skipped (${row.skipped})`
        : row.planned ? (row.planned.length > 0 ? `would apply: ${row.planned.join(", ")}` : "nothing to do")
        : row.failed ? `applied ${row.done.join(", ") || "nothing"}; FAILED at ${row.failed}`
        : row.done.length > 0 ? `applied: ${row.done.join(", ")}` : "nothing to do";
      log(`#${row.number}  ${outcome}${row.note ? `  (${row.note})` : ""}`);
    }
    if (!options.apply) log("\nDry run. Pass --apply to write.");
    return report.some((row) => row.failed) ? 1 : 0;
  }

  throw new Error(`unknown command "${options.command}". Use list, lint, propose or apply.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`work-queue: ${error.message}`);
      process.exit(2);
    },
  );
}
