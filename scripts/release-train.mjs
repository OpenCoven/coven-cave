#!/usr/bin/env node
// One ordered walk through shipping an update.
//
//   pnpm release:train                 # where the release stands, and what is next
//   pnpm release:train list            # every phase and the runbook step it covers
//   pnpm release:train <phase> [--version X.Y.Z] [--prepare] [--state <file>]
//
// Each phase runs the existing check for its step and prints the exact command
// that comes next. The runner is stateless: `status` is derived from the
// stamped version, the tags, the release-candidate run and the published
// release, so two sessions never disagree about a saved cursor.
//
// It reads Git and GitHub and may run the repository's own verification
// scripts. It never tags, pushes, commits or merges: those are printed for the
// maintainer to run. The runbook is docs/workflows/release-train.md.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "OpenCoven/coven-cave";
const GIT_READS = new Set(["fetch", "rev-parse", "show", "ls-remote", "status"]);

// `steps` are the numbered steps of docs/workflows/release-train.md.
// `wraps` are the package scripts the phase runs or tells the maintainer to run.
export const PHASES = [
  { id: "preflight", steps: [1, 2], wraps: [], title: "No stray PRs, main is current and green" },
  { id: "stamp", steps: [3, 4], wraps: ["release:preview", "release:prepare"], title: "Preview and prepare the version stamp" },
  { id: "verify", steps: [5], wraps: ["release:verify", "release:verify-continuity"], title: "Verify the stamp before its PR merges" },
  { id: "rc", steps: [6, 7], wraps: [], title: "Tag a release candidate and wait for its validation" },
  { id: "final", steps: [8], wraps: [], title: "Tag the final release at the validated commit" },
  { id: "publish-check", steps: [9], wraps: ["release:verify-updater"], title: "Confirm the published release and updater manifest" },
  { id: "acceptance", steps: [10], wraps: ["release:acceptance"], title: "Record the three-OS acceptance journey" },
  { id: "rollout", steps: [10], wraps: ["release:rollout"], title: "Gate each widening of the audience" },
  { id: "screenshots", steps: [11], wraps: ["screenshots:readme"], title: "Recapture the README screenshots" },
  { id: "docs", steps: [12], wraps: ["docs:check"], title: "Review docs against the shipped product" },
  { id: "record", steps: [13], wraps: [], title: "Write the release handoff record" },
];

// Where the release stands, from facts anyone can re-observe.
export function deriveStatus(facts) {
  const { localVersion, mainVersion, published } = facts;
  if (mainVersion === published && localVersion === published) {
    return facts.acceptanceRecords > 0
      ? { phase: "preflight", summary: `v${published} is published and has an acceptance record. Nothing is stamped for the next release.` }
      : { phase: "acceptance", summary: `v${published} is published, with no acceptance record in docs/release-acceptance-results yet.` };
  }
  if (mainVersion === published) {
    const pull = facts.stampPull ? `stamp PR #${facts.stampPull} is open` : "no stamp PR is open yet";
    return { phase: "verify", summary: `v${localVersion} is stamped in this checkout but not on main; ${pull}.` };
  }
  if (facts.finalTag) {
    return { phase: "publish-check", summary: `v${mainVersion} is tagged at ${facts.finalTag}; the release workflow publishes it.` };
  }
  const newest = facts.candidateTags.at(-1);
  if (!newest) return { phase: "rc", summary: `v${mainVersion} is stamped on main and has no release-candidate tag.` };
  const run = facts.candidateRun;
  if (run?.status === "completed" && run.conclusion === "success") {
    return { phase: "final", summary: `${newest} is validated; the final tag goes on the same commit.` };
  }
  if (run?.status === "completed") {
    const next = Number(newest.split("-rc.")[1]) + 1;
    return { phase: "rc", summary: `${newest} finished with ${run.conclusion}. Land the fix through a PR, then tag rc.${next}.` };
  }
  return { phase: "rc", summary: `${newest} is pushed; its Release candidate run has not finished.` };
}

export function assertReadOnlyGit(args) {
  if (!GIT_READS.has(args[0])) {
    throw new Error(`release-train never runs \`git ${args[0]}\`; it prints that command for the maintainer`);
  }
}

export function tagCommands({ version, commit, candidate }) {
  const tag = candidate ? `v${version}-rc.${candidate}` : `v${version}`;
  return [`git tag -s "${tag}" ${commit} -m "Coven Cave ${tag}"`, `git push origin "${tag}"`];
}

export function handoffRecord(facts) {
  const known = (value) => value || "not recorded";
  const rows = [
    ["Version", facts.published],
    ["Promoted commit", known(facts.releaseCommit)],
    ["Candidate tag", known(facts.candidateTags.at(-1))],
    ["Candidate run", known(facts.candidateRun?.url)],
    ["Release", known(facts.releaseUrl)],
    ["Acceptance records", facts.acceptanceRecords > 0 ? String(facts.acceptanceRecords) : "not recorded"],
    ["Rollout stage", "not recorded"],
    ["README screenshots", "not recorded"],
    ["Docs review", "not recorded"],
  ];
  return ["| Field | Value |", "| --- | --- |", ...rows.map(([field, value]) => `| ${field} | ${value} |`)].join("\n");
}

// ---------------------------------------------------------------------------
// Observation: Git and GitHub reads only.

function git(args) {
  assertReadOnlyGit(args);
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gh(args) {
  return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function attempt(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function versionOf(json) {
  return JSON.parse(json).version;
}

function compareCandidates(a, b) {
  return Number(a.split("-rc.")[1]) - Number(b.split("-rc.")[1]);
}

// The commit a release tag points at. Release tags are annotated, so the
// peeled `^{}` line is the commit and the plain line is the tag object.
function peeledTag(tag) {
  const lines = attempt(() => git(["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]), "").split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.endsWith("^{}")) ?? lines[0];
  return peeled ? peeled.split(/\s+/)[0] : null;
}

export function gatherFacts() {
  git(["fetch", "--quiet", "origin", "main"]);
  const localVersion = versionOf(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const mainVersion = versionOf(git(["show", "origin/main:package.json"]));
  const latest = JSON.parse(gh(["api", `repos/${REPOSITORY}/releases/latest`]));
  const published = latest.tag_name.replace(/^v/, "");
  const target = mainVersion === published ? localVersion : mainVersion;

  const pulls = JSON.parse(gh(["api", `repos/${REPOSITORY}/pulls?state=open&per_page=100`]));
  const stampPull = pulls.find((pull) => pull.head.ref.startsWith("release/stamp-"))?.number ?? null;
  const tagLines = (pattern) => attempt(() => git(["ls-remote", "--tags", "--refs", "origin", pattern]), "").split("\n").filter(Boolean);
  const candidateTags = tagLines(`v${target}-rc.*`).map((line) => line.split("refs/tags/")[1]).sort(compareCandidates);
  const finalTag = target === published ? null : (tagLines(`v${target}`)[0]?.slice(0, 7) ?? null);

  let candidateRun = null;
  if (candidateTags.length > 0) {
    const runs = attempt(
      () => JSON.parse(gh(["api", `repos/${REPOSITORY}/actions/workflows/release-candidate.yml/runs?branch=${candidateTags.at(-1)}&event=push&per_page=1`])),
      { workflow_runs: [] },
    );
    const run = runs.workflow_runs[0];
    if (run) candidateRun = { status: run.status, conclusion: run.conclusion, url: run.html_url };
  }

  const records = path.join(ROOT, "docs", "release-acceptance-results");
  const acceptanceRecords = existsSync(records) ? readdirSync(records).filter((name) => name.includes(published)).length : 0;
  return {
    localVersion,
    mainVersion,
    published,
    stampPull,
    candidateTags,
    candidateRun,
    finalTag,
    acceptanceRecords,
    openPulls: pulls.map((pull) => ({ number: pull.number, title: pull.title, draft: pull.draft })),
    commit: git(["rev-parse", "origin/main"]),
    releaseCommit: peeledTag(`v${published}`),
    releaseUrl: latest.html_url,
  };
}

// ---------------------------------------------------------------------------
// Phases.

function pnpm(args) {
  const result = spawnSync("pnpm", args, { cwd: ROOT, stdio: "inherit" });
  return result.status === 0;
}

function nextLine(log, text) {
  log(`\nNext: ${text}`);
}

const RUNNERS = {
  preflight({ facts, log }) {
    const ready = facts.openPulls.filter((pull) => !pull.draft);
    log(`Open pull requests: ${facts.openPulls.length} (${ready.length} not draft).`);
    for (const pull of ready) log(`  #${pull.number}  ${pull.title}`);
    if (facts.stampPull) log(`A stamp PR is already open: #${facts.stampPull}. Do not start a second one.`);
    const head = git(["rev-parse", "HEAD"]);
    log(head === facts.commit ? `HEAD equals origin/main (${head.slice(0, 9)}).` : `HEAD ${head.slice(0, 9)} is not origin/main ${facts.commit.slice(0, 9)}.`);
    const runs = attempt(() => JSON.parse(gh(["api", `repos/${REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=1`])), { workflow_runs: [] });
    const ci = runs.workflow_runs[0];
    log(ci ? `Latest main CI: ${ci.conclusion ?? ci.status} on ${ci.head_sha.slice(0, 9)} (${ci.html_url}).` : "Latest main CI: not readable.");
    const green = ci?.conclusion === "success" && ci.head_sha === facts.commit;
    if (!green) log("main is not shown green at its current commit; run `pnpm main:health` before stamping.");
    nextLine(log, "decide which open PRs belong in this release, then `pnpm release:train stamp --version X.Y.Z`.");
    return !facts.stampPull && green;
  },
  stamp({ options, log }) {
    if (!options.version) {
      log("Pass the version to stamp: `pnpm release:train stamp --version X.Y.Z`.");
      return false;
    }
    log(`Create the stamp worktree from current origin/main first:\n  git worktree add --no-track -b release/stamp-v${options.version} .worktrees/release-stamp-v${options.version} origin/main\n`);
    const ok = pnpm([options.prepare ? "release:prepare" : "release:preview", "--version", options.version]);
    nextLine(log, options.prepare
      ? "edit the generated changelog section, then `pnpm release:train verify --version " + options.version + "`."
      : "read the preview, then rerun with `--prepare` from the clean stamp worktree.");
    return ok;
  },
  verify({ facts, options, log }) {
    const version = options.version ?? facts.localVersion;
    const ok = pnpm(["release:verify", "--version", version]) && pnpm(["release:verify-continuity"]);
    nextLine(log, "make the signed stamp commit, open the stamp PR and merge it through the protected path. Then `pnpm release:train rc`.");
    return ok;
  },
  rc({ facts, log }) {
    const status = deriveStatus(facts);
    log(status.summary);
    if (facts.mainVersion === facts.published) {
      log("The stamp is not on main yet, so there is nothing to tag.");
      return false;
    }
    if (status.phase !== "rc") return true;
    const waiting = facts.candidateTags.length > 0 && facts.candidateRun?.status !== "completed";
    if (waiting) {
      nextLine(log, `wait for the run, then rerun this phase: ${facts.candidateRun?.url ?? "the Release candidate workflow"}`);
      return true;
    }
    const candidate = facts.candidateTags.length + 1;
    log(`\nFrom clean main at ${facts.commit.slice(0, 9)}, run:`);
    for (const command of tagCommands({ version: facts.mainVersion, commit: facts.commit, candidate })) log(`  ${command}`);
    nextLine(log, "wait for `Release candidate validated`, then `pnpm release:train final`.");
    return true;
  },
  final({ facts, log }) {
    const status = deriveStatus(facts);
    log(status.summary);
    if (status.phase !== "final") {
      log("The newest candidate is not validated, so the final tag is not authorized.");
      return false;
    }
    log("\nAt the same commit as the validated candidate, run:");
    for (const command of tagCommands({ version: facts.mainVersion, commit: facts.commit })) log(`  ${command}`);
    nextLine(log, "wait for the Release workflow, then `pnpm release:train publish-check`.");
    return true;
  },
  "publish-check"({ facts, log }) {
    log(`Latest published release: v${facts.published} (${facts.releaseUrl}).`);
    const ok = pnpm(["release:verify-updater"]);
    nextLine(log, "record the build, tags, commit and runs (`pnpm release:train record`), then `pnpm release:train acceptance`.");
    return ok;
  },
  acceptance({ facts, log }) {
    log(`Acceptance records for v${facts.published}: ${facts.acceptanceRecords}.`);
    log(`Start one with \`pnpm release:acceptance template ${facts.published}\`, run the journey on each OS, then`);
    log("validate each record with `pnpm release:acceptance validate <record.json>`.");
    nextLine(log, "`pnpm release:train rollout --state <state.json>` before widening the audience.");
    return facts.acceptanceRecords > 0;
  },
  rollout({ options, log }) {
    if (!options.state) {
      const ok = pnpm(["release:rollout", "stages"]);
      nextLine(log, "write the rollout state file, then rerun with `--state <state.json>` for the advance, hold or rollback verdict.");
      return ok;
    }
    const ok = pnpm(["release:rollout", "gate", options.state]);
    nextLine(log, "act on the verdict. When the audience is fully widened, `pnpm release:train screenshots`.");
    return ok;
  },
  screenshots({ log }) {
    log("This starts a production server on an isolated home with demo data, so `pnpm build` must have run.");
    const ok = pnpm(["screenshots:readme"]);
    nextLine(log, "look at each image in screenshots/ before committing, then `pnpm release:train docs`.");
    return ok;
  },
  docs({ log }) {
    const ok = pnpm(["docs:check"]);
    nextLine(log, "fix what is wrong, leave what is deliberate history, and open the docs PR. Then `pnpm release:train record`.");
    return ok;
  },
  record({ facts, log }) {
    log(`Handoff record for v${facts.published}. Fill what is not recorded and post it on the release issue:\n`);
    log(handoffRecord(facts));
    nextLine(log, "`pnpm release:train preflight` when the next release starts.");
    return true;
  },
};

function parseArgs(argv) {
  const options = { command: "status" };
  const args = [...argv];
  if (args[0] && !args[0].startsWith("--")) options.command = args.shift();
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--prepare") options.prepare = true;
    else if (arg === "--version" || arg === "--state") {
      if (args.length === 0) throw new Error(`${arg} needs a value`);
      options[arg.slice(2)] = args.shift();
    } else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

export function main(argv, { log = console.log } = {}) {
  const options = parseArgs(argv);
  if (options.command === "list") {
    for (const phase of PHASES) {
      const steps = [...new Set(phase.steps)].join(" and ");
      log(`${phase.id.padEnd(14)} step ${steps.padEnd(8)} ${phase.title}`);
    }
    return 0;
  }
  const facts = gatherFacts();
  if (options.command === "status") {
    const status = deriveStatus(facts);
    const phase = PHASES.find((candidate) => candidate.id === status.phase);
    log(status.summary);
    log(`Next phase: ${phase.id} (${phase.title}). Run \`pnpm release:train ${phase.id}\`.`);
    return 0;
  }
  const phase = PHASES.find((candidate) => candidate.id === options.command);
  if (!phase) throw new Error(`unknown phase "${options.command}". Run \`pnpm release:train list\`.`);
  log(`== ${phase.id}: ${phase.title} (runbook step ${[...new Set(phase.steps)].join(" and ")}) ==\n`);
  return RUNNERS[phase.id]({ facts, options, log }) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`release-train: ${String(error.stderr ?? "").trim() || error.message}`);
    process.exit(2);
  }
}
