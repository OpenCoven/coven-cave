// Verifies `pnpm performance:shell --control`: the deliberate boot stall must
// fail both modes on the latency assertion alone, with complete samples from
// the expected clean head and no runner errors, retries or skips. The checks
// are shared with the stream verifier in browser-control-verify.mjs.
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateShellBootPerformance, shellBootLimitMs,
  SHELL_BOOT_PERFORMANCE_PROFILE,
} from "../tests/fixtures/shell-boot-performance.ts";
import { runControlVerification, verifyBrowserControl } from "./browser-control-verify.mjs";

const SHELL_CONTROL = Object.freeze({
  units: SHELL_BOOT_PERFORMANCE_PROFILE.modes,
  unitKey: "mode",
  evaluate: evaluateShellBootPerformance,
  limitFor: shellBootLimitMs,
  sampleMetric: "interactiveMs",
  controlTrials: SHELL_BOOT_PERFORMANCE_PROFILE.controlTrials,
});

export function verifyShellControl(exitCode, reports, runner, expectedHead) {
  return verifyBrowserControl(exitCode, reports, runner, expectedHead, SHELL_CONTROL);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-shell-control.mjs <exit-code>");
  const proof = runControlVerification({
    gate: "shell-performance", exitCode: Number(process.argv[2]), options: SHELL_CONTROL,
  });
  console.log(`Shell boot control verified: ${JSON.stringify(proof.modes)}`);
}
