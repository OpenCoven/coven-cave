#!/usr/bin/env node

// Retry tooling for the four Actions runs that have sat in `queued` since
// 2026-07-25 (issue #4905, bead `cave-88pe8`). Both cancellation endpoints
// returned HTTP 500 from 2026-07-25 through 2026-08-10; on 2026-08-30 they
// return HTTP 403 to a PAT without `actions:write` — the backend error has
// changed, so the next retry should run under a token that holds it. The full
// history and the verbatim retry record live in docs/stuck-action-runs.md.
//
// Manual tooling, deliberately NOT wired into CI: it exists for the session
// that retries the endpoints, not for a gate. It never deletes workflow
// history and never touches anything but the run IDs it is given.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO = "OpenCoven/coven-cave";

// The four stuck runs, in the order issue #4905 lists them.
export const DEFAULT_RUN_IDS = [30158074443, 30158074458, 30158095776, 30158095786];

const CANCEL_ENDPOINTS = ["cancel", "force-cancel"];

// GitHub reports a run held by deployment protection as `waiting`/`pending`
// rather than `queued`, but from issue #4905's point of view those are the
// same stuck state. A 404 on the poll means the run is gone — nothing stuck.
const STUCK_STATUSES = new Set(["queued", "waiting", "pending"]);

const DEFAULT_RETRIES = 2; // additional attempts per endpoint, after the first
const DEFAULT_BACKOFF_MS = 2000;

/**
 * Run one `gh api` call and return its HTTP status and response body.
 *
 * With `--include`, `gh` writes the response headers — including the status
 * line — to stdout even when the status is an error, so the status is parsed
 * from stdout rather than from the exit code. A status of 0 means no HTTP
 * exchange happened at all (spawn failure, auth prompt): callers treat that
 * as transient and retry.
 */
export function ghApi({ method, endpoint }, { execFile = execFileSync } = {}) {
  // stderr is piped rather than inherited: `gh` narrates every failed call
  // ("gh: Resource not accessible … (HTTP 403)") and the table below is the
  // only narrator this script needs.
  let stdout;
  try {
    stdout = execFile("gh", ["api", "-i", "-X", method, endpoint], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error("gh is not available on PATH — install the GitHub CLI and authenticate");
    }
    stdout = typeof err?.stdout === "string" ? err.stdout : "";
    const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
    if (stderr && !stdout.trim()) return { status: 0, body: stderr };
  }
  const matches = [...stdout.matchAll(/^HTTP\/\S+ (\d{3})/gm)];
  const status = matches.length > 0 ? Number(matches[matches.length - 1][1]) : 0;
  // The body starts after the first blank line; on redirects there are several
  // header blocks and the last one wins, so cut at the final blank line.
  const separator = stdout.lastIndexOf("\r\n\r\n");
  const body = separator >= 0 ? stdout.slice(separator + 4).trim() : "";
  return { status, body };
}

const isAccepted = (status) => status === 200 || status === 202;
const isTransient = (status) => status === 0 || status === 429 || status >= 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Try to cancel one run: `/cancel` first, then `/force-cancel`, retrying
 * transient failures (HTTP 5xx / 429 / no exchange) with a doubling backoff.
 * 4xx failures are deterministic — a retry cannot lift a permission wall — so
 * they fall through to the next endpoint instead of burning the budget.
 *
 * Returns the attempt rows for this run; each row carries the endpoint, the
 * HTTP code, and the response body snippet.
 */
export async function cancelOneRun(
  runId,
  { retries = DEFAULT_RETRIES, backoffMs = DEFAULT_BACKOFF_MS, api = ghApi, sleepImpl = sleep, log = console.log } = {},
) {
  const rows = [];
  for (const endpoint of CANCEL_ENDPOINTS) {
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const path = `/repos/${REPO}/actions/runs/${runId}/${endpoint}`;
      let result;
      try {
        result = api({ method: "POST", endpoint: path });
      } catch (err) {
        result = { status: 0, body: err instanceof Error ? err.message : String(err) };
      }
      rows.push({ runId, endpoint, attempt, http: result.status, body: result.body });
      log(`run ${runId} ${endpoint} attempt ${attempt}: HTTP ${result.status || "no exchange"}${result.body ? ` — ${result.body.slice(0, 160)}` : ""}`);
      if (isAccepted(result.status)) return rows;
      if (!isTransient(result.status)) break; // deterministic; try the next endpoint
      if (attempt <= retries) await sleepImpl(backoffMs * 2 ** (attempt - 1));
    }
  }
  return rows;
}

/** Poll the run's current status and conclusion (a missing run reports itself). */
export function pollRun(runId, { api = ghApi } = {}) {
  let result;
  try {
    result = api({ method: "GET", endpoint: `/repos/${REPO}/actions/runs/${runId}` });
  } catch (err) {
    return { status: "poll_failed", conclusion: null, detail: err instanceof Error ? err.message : String(err) };
  }
  if (result.status === 404) return { status: "not_found", conclusion: null, detail: "run no longer exists" };
  if (result.status !== 200) return { status: "poll_failed", conclusion: null, detail: `HTTP ${result.status}` };
  try {
    const run = JSON.parse(result.body);
    return { status: run.status ?? "unknown", conclusion: run.conclusion ?? null, detail: "" };
  } catch {
    return { status: "poll_failed", conclusion: null, detail: "non-JSON body" };
  }
}

const pad = (value, width) => String(value).padEnd(width);

/**
 * Cancel each run, poll its resulting state, print one table row per attempt
 * plus the final state, and report whether any run remains stuck. Exit is
 * non-zero when any polled run still reports a queued-class status.
 */
export async function cancelStuckRuns(
  runIds,
  { retries = DEFAULT_RETRIES, backoffMs = DEFAULT_BACKOFF_MS, api = ghApi, sleepImpl = sleep, log = console.log } = {},
) {
  const attempts = [];
  const outcomes = [];
  for (const runId of runIds) {
    attempts.push(...(await cancelOneRun(runId, { retries, backoffMs, api, sleepImpl, log })));
    const poll = pollRun(runId, { api });
    const last = attempts.filter((row) => row.runId === runId).at(-1);
    outcomes.push({ runId, lastEndpoint: last.endpoint, lastHttp: last.http, ...poll });
    log(`run ${runId}: status=${poll.status} conclusion=${poll.conclusion ?? "none"}${poll.detail ? ` (${poll.detail})` : ""}`);
  }

  log("");
  log("Per-attempt record:");
  log(`${pad("RUN ID", 14)}${pad("ENDPOINT", 14)}${pad("ATTEMPT", 9)}HTTP`);
  for (const row of attempts) {
    log(`${pad(row.runId, 14)}${pad(row.endpoint, 14)}${pad(row.attempt, 9)}${row.http || "no exchange"}`);
  }

  log("");
  log("Resulting status:");
  log(`${pad("RUN ID", 14)}${pad("ENDPOINT", 14)}${pad("HTTP", 6)}${pad("STATUS", 14)}CONCLUSION`);
  for (const outcome of outcomes) {
    log(
      `${pad(outcome.runId, 14)}${pad(outcome.lastEndpoint, 14)}${pad(outcome.lastHttp || "-", 6)}${pad(outcome.status, 14)}${outcome.conclusion ?? "none"}`,
    );
  }

  const stuck = outcomes.filter((outcome) => STUCK_STATUSES.has(outcome.status));
  log("");
  if (stuck.length === 0) {
    log(`all ${runIds.length} run(s) left the queue — issue #4905's close condition may be met`);
    return { attempts, outcomes, stuck: [] };
  }
  log(`${stuck.length} of ${runIds.length} run(s) remain queued: ${stuck.map((o) => o.runId).join(", ")}`);
  return { attempts, outcomes, stuck };
}

function parseArgs(argv) {
  const values = { runIds: [], retries: DEFAULT_RETRIES, backoffMs: DEFAULT_BACKOFF_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--retries") {
      values.retries = Number(argv[(index += 1)]);
      if (!Number.isInteger(values.retries) || values.retries < 0) throw new Error("--retries expects a non-negative integer");
    } else if (arg === "--backoff-ms") {
      values.backoffMs = Number(argv[(index += 1)]);
      if (!Number.isFinite(values.backoffMs) || values.backoffMs < 0) throw new Error("--backoff-ms expects a non-negative number");
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg} (supported: --retries N, --backoff-ms N)`);
    } else {
      const runId = Number(arg);
      if (!Number.isInteger(runId) || runId <= 0) throw new Error(`run IDs must be positive integers, got ${arg}`);
      values.runIds.push(runId);
    }
  }
  if (values.runIds.length === 0) values.runIds = DEFAULT_RUN_IDS;
  return values;
}

async function main(argv) {
  const { runIds, retries, backoffMs } = parseArgs(argv);
  const { stuck } = await cancelStuckRuns(runIds, { retries, backoffMs });
  return stuck.length === 0 ? 0 : 1;
}

// Run when invoked directly; stay quiet when a test imports the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exitCode = code,
    (err) => {
      console.error(`cancel-stuck-action-runs: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
