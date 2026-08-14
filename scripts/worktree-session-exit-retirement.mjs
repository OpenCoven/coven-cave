#!/usr/bin/env node
// Retire only the worktrees the local status tool has already classified as safe.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const statusScript = join(scriptDir, "worktree-status.mjs");

function command(args, cwd) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function retain(path, reason) {
  console.error(`Retained ${path}: ${reason}`);
}

export function main({ cwd = process.cwd(), run = command } = {}) {
  const status = run(["node", statusScript, "--json"], cwd);
  if (!status.ok) {
    console.error(`worktree-session-exit-retirement: status unavailable: ${status.output}`);
    return 0;
  }

  let report;
  try {
    report = JSON.parse(status.output);
  } catch {
    console.error("worktree-session-exit-retirement: status returned invalid JSON");
    return 0;
  }
  if (!Array.isArray(report.rows)) {
    console.error("worktree-session-exit-retirement: status report has no rows");
    return 0;
  }

  const candidates = report.rows.filter((row) => row.verdict === "SAFE-RETIRE");
  let retired = 0;
  let blocked = 0;
  for (const candidate of candidates) {
    if (candidate.locked) {
      const unlock = run(["git", "worktree", "unlock", candidate.path], cwd);
      if (!unlock.ok) {
        blocked += 1;
        retain(candidate.path, `could not unlock: ${unlock.output}`);
        continue;
      }
    }

    const remove = run(["git", "worktree", "remove", candidate.path], cwd);
    if (!remove.ok) {
      blocked += 1;
      retain(candidate.path, `could not remove: ${remove.output}`);
      continue;
    }

    retired += 1;
    if (candidate.branch) {
      const branch = run(["git", "branch", "-d", candidate.branch], cwd);
      if (!branch.ok) {
        console.error(
          `Retired ${candidate.path}; retained branch ${candidate.branch}: ${branch.output}`,
        );
      }
    }
  }

  console.log(
    `Worktree session-exit retirement: candidates ${candidates.length}; retired ${retired}; blocked ${blocked}`,
  );
  console.log(`Retired: ${retired}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
