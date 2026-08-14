import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function normalizePlaywrightCliArgs(rawArgs) {
  return rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
}

export function resolvePlaywrightCliPath() {
  return createRequire(import.meta.url).resolve("@playwright/test/cli");
}

export function buildPlaywrightInvocation(rawArgs, options = {}) {
  const args = normalizePlaywrightCliArgs(rawArgs);
  const cliPath = options.cliPath ?? resolvePlaywrightCliPath();
  return {
    command: options.execPath ?? process.execPath,
    args: [cliPath, "test", ...args],
  };
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isMain) {
  const invocation = buildPlaywrightInvocation(process.argv.slice(2));
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
