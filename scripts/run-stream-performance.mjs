import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { researchPackageConfig } from "./research-package-config.mjs";

const require = createRequire(import.meta.url);
const environmentKeys = [
  "PATH", "Path", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP",
  "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "PATHEXT", "CI",
  "PLAYWRIGHT_BROWSERS_PATH", "COVEN_CAVE_PORT",
];

export function parseStreamArguments(args) {
  if (args.length === 0) return { control: false };
  if (args.length === 1 && args[0] === "--control") return { control: true };
  throw new Error("Usage: pnpm performance:stream [--control]; the workload cannot be overridden");
}

/**
 * The room visibility the measured build is compiled with (#6338). Blank means
 * the lane's default, `all`, which the ordinary suite also uses. Any other
 * value is passed to the build verbatim as `NEXT_PUBLIC_CAVE_ROOMS`; `none`
 * names no registered room, so every optional room is absent. The workload
 * itself cannot be changed by this setting.
 */
export function parseStreamRooms(raw) {
  const rooms = (raw ?? "").trim().toLowerCase();
  if (rooms === "") return null;
  if (!/^[a-z0-9*-]+(,[a-z0-9*-]+)*$/.test(rooms)) {
    throw new Error(`CAVE_STREAM_ROOMS must be blank, all, none or comma-separated room ids; got ${JSON.stringify(raw)}`);
  }
  return rooms;
}

export function buildStreamInvocation({ sourceEnv, stateRoot, artifactRoot, control, rooms = null }) {
  const env = Object.fromEntries(environmentKeys
    .filter(key => typeof sourceEnv[key] === "string")
    .map(key => [key, sourceEnv[key]]));
  Object.assign(env, {
    CAVE_STREAM_PERFORMANCE: "1",
    CAVE_STREAM_CONTROL: control ? "1" : "0",
    CAVE_STREAM_STATE_ROOT: stateRoot,
    CAVE_STREAM_ARTIFACT_ROOT: artifactRoot,
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(artifactRoot, "playwright.json"),
    NEXT_TELEMETRY_DISABLED: "1",
  });
  if (rooms !== null) env.CAVE_STREAM_ROOMS = rooms;
  return {
    cli: require.resolve("@playwright/test/cli"),
    args: ["test", "tests/chat-stream-performance.spec.ts", "--project=desktop",
      "--workers=1", "--retries=0", "--no-deps", "--reporter=list,json",
      `--output=${path.join(artifactRoot, "results")}`],
    env,
  };
}

export function assertIsolatedStreamBuild(root) {
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(path.join(root, name))) {
      throw new Error(`Refusing a performance build with local dotenv file ${name}; use a clean worktree`);
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { control } = parseStreamArguments(process.argv.slice(2));
  const rooms = parseStreamRooms(process.env.CAVE_STREAM_ROOMS);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertIsolatedStreamBuild(root);
  process.chdir(root);
  const invocationId = randomUUID();
  const artifactRoot = path.join(root, "artifacts", "stream-performance", invocationId);
  const stateRoot = mkdtempSync(path.join(os.tmpdir(), "cave-stream-state-"));
  mkdirSync(path.join(stateRoot, "home"));
  mkdirSync(artifactRoot, { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  writeFileSync(path.join(artifactRoot, "invocation.json"), JSON.stringify({
    invocationId, control, startedAt: new Date().toISOString(),
    head: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]).length > 0,
    node: process.version, platform: process.platform, arch: process.arch,
    osRelease: os.release(), cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(), stateRoot,
    // The measured configuration: which rooms the build shows and whether the
    // optional Research package was installed when it was compiled (#6338).
    rooms: rooms ?? "all", researchPackageInstalled: researchPackageConfig(root).available,
  }, null, 2));
  const invocation = buildStreamInvocation({ sourceEnv: process.env, stateRoot, artifactRoot, control, rooms });
  // Keep the CLI in this process so Playwright owns browsers and webServer,
  // including its normal timeout and signal handling.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, invocation.env);
  process.argv = [process.execPath, invocation.cli, ...invocation.args];
  console.log(`Stream performance evidence: ${artifactRoot}`);
  await import(pathToFileURL(invocation.cli).href);
}
