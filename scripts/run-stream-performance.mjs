import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertIsolatedPerformanceBuild,
  buildBrowserPerformanceInvocation,
  launchPlaywright,
  prepareBrowserPerformanceInvocation,
} from "./browser-performance-launch.mjs";
import { researchPackageConfig } from "./research-package-config.mjs";

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
  const invocation = buildBrowserPerformanceInvocation({
    sourceEnv, artifactRoot, spec: "tests/chat-stream-performance.spec.ts",
    env: {
      CAVE_STREAM_PERFORMANCE: "1",
      CAVE_STREAM_CONTROL: control ? "1" : "0",
      CAVE_STREAM_STATE_ROOT: stateRoot,
      CAVE_STREAM_ARTIFACT_ROOT: artifactRoot,
    },
  });
  // Only the parsed, runner-chosen visibility reaches the build; the source
  // environment's own CAVE_STREAM_ROOMS is outside the allowlist.
  if (rooms !== null) invocation.env.CAVE_STREAM_ROOMS = rooms;
  return invocation;
}

export const assertIsolatedStreamBuild = assertIsolatedPerformanceBuild;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { control } = parseStreamArguments(process.argv.slice(2));
  const rooms = parseStreamRooms(process.env.CAVE_STREAM_ROOMS);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertIsolatedStreamBuild(root);
  process.chdir(root);
  const { artifactRoot, stateRoot } = prepareBrowserPerformanceInvocation({
    root, gate: "stream-performance",
    // The measured configuration: which rooms the build shows and whether the
    // optional Research package was installed when it was compiled (#6338).
    record: { control, rooms: rooms ?? "all", researchPackageInstalled: researchPackageConfig(root).available },
  });
  const invocation = buildStreamInvocation({ sourceEnv: process.env, stateRoot, artifactRoot, control, rooms });
  console.log(`Stream performance evidence: ${artifactRoot}`);
  await launchPlaywright(invocation);
}
