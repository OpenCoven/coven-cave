// `pnpm build` with the Turbopack flake retry shared by CI, full validation and
// the release build (#6087). Up to three attempts with a clean .next between
// them, except that a deterministic build-gate failure stops at once: retrying
// it only repeats the same report after another full build.
//
//   node scripts/build-with-retry.mjs              # runs `pnpm build`
//   node scripts/build-with-retry.mjs <cmd> [args]  # runs another command (tests)
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILD_GATE_EXIT_CODE } from "./build-gate-exit.mjs";

export const BUILD_ATTEMPTS = 3;
export const DEFAULT_BUILD_COMMAND = Object.freeze(["pnpm", "build"]);

function runCommand(command, cwd) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  // A signal (an OOM kill, for one) leaves no status: treat it as retryable.
  return result.status ?? 1;
}

/** Runs the build until it succeeds, a build gate fails, or the attempts run out. Returns the exit status. */
export function buildWithRetry({
  command = DEFAULT_BUILD_COMMAND,
  attempts = BUILD_ATTEMPTS,
  cwd = process.cwd(),
  run = runCommand,
  log = console.log,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = run(command, cwd);
    if (status === 0) return 0;
    if (status === BUILD_GATE_EXIT_CODE) {
      log(`::error::pnpm build failed a deterministic build gate (exit ${status}); not retrying`);
      return BUILD_GATE_EXIT_CODE;
    }
    if (attempt < attempts) {
      log(`::warning::pnpm build attempt ${attempt} failed; retrying with clean .next`);
      rmSync(path.join(cwd, ".next"), { recursive: true, force: true });
    }
  }
  log(`::error::pnpm build failed after ${attempts} attempts`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_BUILD_COMMAND;
  process.exit(buildWithRetry({ command }));
}
