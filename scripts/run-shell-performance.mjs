// `pnpm performance:shell [--control]`: the isolated production browser gate
// behind `shell.warm-boot.p95-ms` and `shell.offline-boot.p95-ms` (#6333).
// Same isolation as the stream gate: allowlisted environment, synthetic state
// root, built production server owned by Playwright, evidence per invocation
// under artifacts/shell-performance/<invocation-id>/.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertIsolatedPerformanceBuild,
  buildBrowserPerformanceInvocation,
  launchPlaywright,
  prepareBrowserPerformanceInvocation,
} from "./browser-performance-launch.mjs";

export function parseShellArguments(args) {
  if (args.length === 0) return { control: false };
  if (args.length === 1 && args[0] === "--control") return { control: true };
  throw new Error("Usage: pnpm performance:shell [--control]; the workload cannot be overridden");
}

export function buildShellInvocation({ sourceEnv, stateRoot, artifactRoot, control }) {
  return buildBrowserPerformanceInvocation({
    sourceEnv, artifactRoot, spec: "tests/shell-boot-performance.spec.ts",
    env: {
      CAVE_SHELL_PERFORMANCE: "1",
      CAVE_SHELL_CONTROL: control ? "1" : "0",
      CAVE_SHELL_STATE_ROOT: stateRoot,
      CAVE_SHELL_ARTIFACT_ROOT: artifactRoot,
    },
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { control } = parseShellArguments(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertIsolatedPerformanceBuild(root);
  process.chdir(root);
  const { artifactRoot, stateRoot } = prepareBrowserPerformanceInvocation({
    root, gate: "shell-performance", record: { control },
  });
  const invocation = buildShellInvocation({ sourceEnv: process.env, stateRoot, artifactRoot, control });
  console.log(`Shell boot performance evidence: ${artifactRoot}`);
  await launchPlaywright(invocation);
}
