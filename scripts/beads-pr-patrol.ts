#!/usr/bin/env node --experimental-strip-types
// PR morning/evening triage patrol (cave-hlv.7). Sweeps every open PR through
// the bridge's lane classifier, renders a window-ordered digest (morning
// unblocks, evening lands), flags stale and bead-less PRs, and — with --apply
// — mirrors each linked PR's state into its beads so the queue stays honest
// without anyone hand-copying GitHub state. Report-only by default; never
// merges anything.
import { summarizePullRequest } from "../src/lib/beads-pr-management.ts";
import {
  buildPatrolDigest,
  renderPatrolDigest,
  type PatrolWindow,
} from "../src/lib/beads-pr-patrol.ts";
import { applyBeadUpdate, ghPrList, planBeadUpdates } from "./beads-pr-shared.ts";

type Options = {
  repo: string | null;
  window: PatrolWindow | null;
  apply: boolean;
  json: boolean;
  limit: string;
  staleHours: number;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    repo: null,
    window: null,
    apply: false,
    json: false,
    limit: "100",
    staleHours: 24,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--":
        break;
      case "--repo":
        opts.repo = argv[++i] ?? null;
        break;
      case "--window": {
        const value = argv[++i] ?? "";
        if (value !== "morning" && value !== "evening") {
          throw new Error("--window must be morning or evening");
        }
        opts.window = value;
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
      case "--stale-hours": {
        const value = Number(argv[++i] ?? "");
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error("--stale-hours requires a positive number");
        }
        opts.staleHours = value;
        break;
      }
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
  console.log(`Usage: node --experimental-strip-types scripts/beads-pr-patrol.ts --repo OWNER/REPO [--window morning|evening] [--apply] [--json] [--stale-hours N]

Twice-daily PR triage sweep. Classifies every open PR into familiar lanes and
renders a window-ordered digest: morning leads with fixing failing checks and
requested changes; evening leads with landing ready-to-merge work. Flags PRs
that went stale and PRs mentioning no bead id.

Default is report-only. --apply mirrors every linked PR's current state into
its beads (external-ref + appended state note) — the patrol-sized sweep of the
bridge's per-PR apply. The patrol never merges; the merge gate is unchanged.

--window defaults by local clock (before noon = morning).`);
}

function defaultWindow(): PatrolWindow {
  return new Date().getHours() < 12 ? "morning" : "evening";
}

function run(opts: Options) {
  if (!opts.repo) throw new Error("--repo OWNER/REPO is required");
  const window = opts.window ?? defaultWindow();
  const summaries = ghPrList(opts.repo, opts.limit).map(summarizePullRequest);
  const digest = buildPatrolDigest(summaries, {
    window,
    nowMs: Date.now(),
    staleAfterHours: opts.staleHours,
  });
  const planned = planBeadUpdates(summaries);
  const beadUpdates = opts.apply ? planned.map(applyBeadUpdate) : planned;
  return { ok: true, apply: opts.apply, window, digest, summaries, beadUpdates };
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const result = run(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const lines = [renderPatrolDigest(result.digest), `Mode: ${result.apply ? "apply" : "report-only"}`];
    if (result.apply) {
      lines.push(
        result.beadUpdates.length > 0
          ? `Mirrored ${result.beadUpdates.length} bead update${result.beadUpdates.length === 1 ? "" : "s"}.`
          : "No linked beads to mirror.",
      );
    }
    console.log(lines.join("\n"));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`beads-pr-patrol: ${message}`);
  process.exit(1);
}
