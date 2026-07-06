#!/usr/bin/env node --experimental-strip-types
import { summarizePullRequest } from "../src/lib/beads-pr-management.ts";
import { applyBeadUpdate, ghPrList, planBeadUpdates } from "./beads-pr-shared.ts";

type Options = {
  repo: string | null;
  pr: number | null;
  apply: boolean;
  json: boolean;
  limit: string;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = { repo: null, pr: null, apply: false, json: false, limit: "100" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--":
        break;
      case "--repo":
        opts.repo = argv[++i] ?? null;
        break;
      case "--pr": {
        const value = Number(argv[++i] ?? "");
        if (!Number.isInteger(value) || value <= 0) throw new Error("--pr requires a positive PR number");
        opts.pr = value;
        break;
      }
      case "--apply":
        opts.apply = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--limit":
        opts.limit = argv[++i] ?? "100";
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unsupported argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node --experimental-strip-types scripts/beads-pr-bridge.ts --repo OWNER/REPO [--pr NUMBER] [--apply] [--json]

Reads open GitHub PRs with gh, classifies each PR into a familiar PR lane, and
plans Beads updates for PRs that mention a bead ID such as cave-hlv.5.

Default mode is report-only. Pass --pr NUMBER before --apply when you want to
update one PR's linked beads without touching unrelated open PRs.`);
}

function renderText(result: ReturnType<typeof run>) {
  const lines = [
    `GitHub PR bridge: ${result.summaries.length} open PR${result.summaries.length === 1 ? "" : "s"} scanned`,
    `Mode: ${result.apply ? "apply" : "report-only"}`,
  ];
  for (const summary of result.summaries) {
    const beads = summary.beadIds.length > 0 ? summary.beadIds.join(", ") : "no bead";
    lines.push(`#${summary.number} ${summary.lane} [${beads}] ${summary.title}`);
  }
  if (result.beadUpdates.length === 0) lines.push("No linked bead updates planned.");
  return lines.join("\n");
}

function run(opts: Options) {
  if (!opts.repo) throw new Error("--repo OWNER/REPO is required");
  const prs = ghPrList(opts.repo, opts.limit);
  const filtered = opts.pr === null ? prs : prs.filter((pr) => pr.number === opts.pr);
  const summaries = filtered.map(summarizePullRequest);
  const planned = planBeadUpdates(summaries);
  const beadUpdates = opts.apply ? planned.map(applyBeadUpdate) : planned;
  return { ok: true, apply: opts.apply, summaries, beadUpdates };
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const result = run(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`beads-pr-bridge: ${message}`);
  process.exit(1);
}
