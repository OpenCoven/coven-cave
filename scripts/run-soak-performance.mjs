// `pnpm performance:soak [--minutes N]`: the isolated production soak lane
// (#6347). Same isolation as the stream and shell gates: allowlisted
// environment, synthetic state root, built production server owned by
// Playwright, evidence per invocation under artifacts/soak-performance/<id>/.
// The duration is the only input; the workload cannot be overridden.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertIsolatedPerformanceBuild,
  buildBrowserPerformanceInvocation,
  launchPlaywright,
  prepareBrowserPerformanceInvocation,
} from "./browser-performance-launch.mjs";
import { SOAK_PERFORMANCE_PROFILE } from "../tests/fixtures/soak-performance.ts";

// The fixture profile owns the bounds; the launcher only parses against them.
export const SOAK_DEFAULT_MINUTES = SOAK_PERFORMANCE_PROFILE.defaultMinutes;
export const SOAK_MINIMUM_MINUTES = SOAK_PERFORMANCE_PROFILE.minimumMinutes;
export const SOAK_MAXIMUM_MINUTES = SOAK_PERFORMANCE_PROFILE.maximumMinutes;

export function parseSoakArguments(args) {
  if (args.length === 0) return { minutes: SOAK_DEFAULT_MINUTES };
  if (args.length === 2 && args[0] === "--minutes" && /^[0-9]+$/.test(args[1])) {
    const minutes = Number(args[1]);
    if (minutes >= SOAK_MINIMUM_MINUTES && minutes <= SOAK_MAXIMUM_MINUTES) return { minutes };
  }
  throw new Error(
    `Usage: pnpm performance:soak [--minutes N] with ${SOAK_MINIMUM_MINUTES} <= N <= ${SOAK_MAXIMUM_MINUTES}; the workload cannot be overridden`,
  );
}

export function buildSoakInvocation({ sourceEnv, stateRoot, artifactRoot, minutes }) {
  return buildBrowserPerformanceInvocation({
    sourceEnv, artifactRoot, spec: "tests/soak-performance.spec.ts",
    env: {
      CAVE_SOAK_PERFORMANCE: "1",
      CAVE_SOAK_MINUTES: String(minutes),
      CAVE_SOAK_STATE_ROOT: stateRoot,
      CAVE_SOAK_ARTIFACT_ROOT: artifactRoot,
    },
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { minutes } = parseSoakArguments(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertIsolatedPerformanceBuild(root);
  process.chdir(root);
  const { artifactRoot, stateRoot } = prepareBrowserPerformanceInvocation({
    root, gate: "soak-performance", record: { minutes },
  });
  const invocation = buildSoakInvocation({ sourceEnv: process.env, stateRoot, artifactRoot, minutes });
  console.log(`Soak performance evidence (${minutes} min): ${artifactRoot}`);
  await launchPlaywright(invocation);
}
