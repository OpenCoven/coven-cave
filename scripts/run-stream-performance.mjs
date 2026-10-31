import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertIsolatedPerformanceBuild,
  buildBrowserPerformanceInvocation,
  launchPlaywright,
  prepareBrowserPerformanceInvocation,
} from "./browser-performance-launch.mjs";

export function parseStreamArguments(args) {
  if (args.length === 0) return { control: false };
  if (args.length === 1 && args[0] === "--control") return { control: true };
  throw new Error("Usage: pnpm performance:stream [--control]; the workload cannot be overridden");
}

export function buildStreamInvocation({ sourceEnv, stateRoot, artifactRoot, control }) {
  return buildBrowserPerformanceInvocation({
    sourceEnv, artifactRoot, spec: "tests/chat-stream-performance.spec.ts",
    env: {
      CAVE_STREAM_PERFORMANCE: "1",
      CAVE_STREAM_CONTROL: control ? "1" : "0",
      CAVE_STREAM_STATE_ROOT: stateRoot,
      CAVE_STREAM_ARTIFACT_ROOT: artifactRoot,
    },
  });
}

export const assertIsolatedStreamBuild = assertIsolatedPerformanceBuild;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { control } = parseStreamArguments(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertIsolatedStreamBuild(root);
  process.chdir(root);
  const { artifactRoot, stateRoot } = prepareBrowserPerformanceInvocation({
    root, gate: "stream-performance", record: { control },
  });
  const invocation = buildStreamInvocation({ sourceEnv: process.env, stateRoot, artifactRoot, control });
  console.log(`Stream performance evidence: ${artifactRoot}`);
  await launchPlaywright(invocation);
}
