import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateStreamPerformance, STREAM_PERFORMANCE_LIMIT_MS,
  STREAM_PERFORMANCE_PROFILE,
} from "../tests/fixtures/chat-stream-performance.ts";
import { runControlVerification, verifyBrowserControl } from "./browser-control-verify.mjs";

const STREAM_CONTROL = Object.freeze({
  units: STREAM_PERFORMANCE_PROFILE.patterns,
  unitKey: "pattern",
  evaluate: evaluateStreamPerformance,
  limitFor: () => STREAM_PERFORMANCE_LIMIT_MS,
  sampleMetric: "longestTaskMs",
  controlTrials: 6,
});

export function verifyStreamControl(exitCode, reports, runner, expectedHead) {
  return verifyBrowserControl(exitCode, reports, runner, expectedHead, STREAM_CONTROL);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-stream-control.mjs <exit-code>");
  const proof = runControlVerification({
    gate: "stream-performance", exitCode: Number(process.argv[2]), options: STREAM_CONTROL,
  });
  console.log(JSON.stringify(proof));
}
