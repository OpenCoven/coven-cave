// Shared launcher for the isolated production browser performance gates
// (`pnpm performance:stream`, `pnpm performance:shell`). Each gate keeps its
// own argument parser and env flags; this module owns the allowlisted
// environment, the per-invocation artifact/state roots, the invocation record
// and the in-process Playwright CLI hand-off, so the two runners cannot drift
// apart on what they strip or where they write.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Everything else in the launching shell (credentials, NODE_OPTIONS, real
// Coven/Cave homes, dotenv paths) is dropped before Playwright starts.
export const BROWSER_PERFORMANCE_ENVIRONMENT_KEYS = Object.freeze([
  "PATH", "Path", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP",
  "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "PATHEXT", "CI",
  "PLAYWRIGHT_BROWSERS_PATH", "COVEN_CAVE_PORT",
]);

export function allowlistedEnvironment(sourceEnv) {
  return Object.fromEntries(BROWSER_PERFORMANCE_ENVIRONMENT_KEYS
    .filter(key => typeof sourceEnv[key] === "string")
    .map(key => [key, sourceEnv[key]]));
}

export function buildBrowserPerformanceInvocation({ sourceEnv, artifactRoot, spec, env }) {
  const invocationEnv = allowlistedEnvironment(sourceEnv);
  Object.assign(invocationEnv, env, {
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(artifactRoot, "playwright.json"),
    NEXT_TELEMETRY_DISABLED: "1",
  });
  return {
    cli: require.resolve("@playwright/test/cli"),
    args: ["test", spec, "--project=desktop",
      "--workers=1", "--retries=0", "--no-deps", "--reporter=list,json",
      `--output=${path.join(artifactRoot, "results")}`],
    env: invocationEnv,
  };
}

export function assertIsolatedPerformanceBuild(root) {
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(path.join(root, name))) {
      throw new Error(`Refusing a performance build with local dotenv file ${name}; use a clean worktree`);
    }
  }
}

/**
 * Create the per-invocation artifact directory and synthetic state root, and
 * write `invocation.json` with the head, dirty state and machine identity the
 * verdict helpers later check. `record` goes first so a gate's own flags
 * (`control`) sit beside the identity rather than being inferred from it.
 */
export function prepareBrowserPerformanceInvocation({ root, gate, record = {} }) {
  const invocationId = randomUUID();
  const artifactRoot = path.join(root, "artifacts", gate, invocationId);
  const stateRoot = mkdtempSync(path.join(os.tmpdir(), `cave-${gate}-state-`));
  mkdirSync(path.join(stateRoot, "home"));
  mkdirSync(artifactRoot, { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(path.join(artifactRoot, "invocation.json"), JSON.stringify({
    invocationId, ...record, startedAt: new Date().toISOString(),
    head: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]).length > 0,
    node: process.version, platform: process.platform, arch: process.arch,
    osRelease: os.release(), cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(), stateRoot,
  }, null, 2));
  return { invocationId, artifactRoot, stateRoot };
}

/**
 * Hand this process to the Playwright CLI so it owns browsers and webServer,
 * including its normal timeout and signal handling. The ambient environment
 * is replaced wholesale with the allowlisted invocation environment.
 */
export async function launchPlaywright(invocation) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, invocation.env);
  process.argv = [process.execPath, invocation.cli, ...invocation.args];
  await import(pathToFileURL(invocation.cli).href);
}
