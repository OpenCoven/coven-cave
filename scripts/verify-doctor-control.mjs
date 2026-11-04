// Verifies `pnpm performance:doctor --control`: the deliberate CLI stall must
// fail the doctor unit on the latency assertion alone, with complete samples
// from the expected clean head and no runner errors, retries or skips. The
// checks are shared with the stream and shell verifiers.
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateDoctorExecPerformance, doctorExecLimitMs,
  DOCTOR_EXEC_PERFORMANCE_PROFILE,
} from "../tests/fixtures/doctor-exec-performance.ts";
import { runControlVerification, verifyBrowserControl } from "./browser-control-verify.mjs";

const DOCTOR_CONTROL = Object.freeze({
  units: DOCTOR_EXEC_PERFORMANCE_PROFILE.commands,
  unitKey: "command",
  evaluate: evaluateDoctorExecPerformance,
  limitFor: doctorExecLimitMs,
  sampleMetric: "wallMs",
  controlTrials: DOCTOR_EXEC_PERFORMANCE_PROFILE.controlTrials,
});

export function verifyDoctorControl(exitCode, reports, runner, expectedHead) {
  return verifyBrowserControl(exitCode, reports, runner, expectedHead, DOCTOR_CONTROL);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-doctor-control.mjs <exit-code>");
  const proof = runControlVerification({
    gate: "doctor-performance", exitCode: Number(process.argv[2]), options: DOCTOR_CONTROL,
  });
  console.log(`Doctor exec control verified: ${JSON.stringify(proof.commands)}`);
}
