import { expect, test } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DAEMON_DIAGNOSTIC_CORRELATION_HEADER } from "../src/lib/server/daemon-diagnostics";
import {
  doctorExecLimitMs, evaluateDoctorExecPerformance,
  DOCTOR_EXEC_PERFORMANCE_PROFILE as profile,
  type DoctorExecSample,
} from "./fixtures/doctor-exec-performance";

// coven doctor wall clock through the exec route (#6346, under #6119). One
// hundred sequential `POST /api/coven/exec {"command":"doctor"}` requests
// against the production server after one untimed prime; the verdict helper
// grades the nearest-rank p95 against the catalogue ceiling, which is the
// route's own timeout, and fails closed on any trial that did not prove the
// CLI ran or the ceiling fired.

test.skip(process.env.CAVE_DOCTOR_PERFORMANCE !== "1", "Run pnpm performance:doctor");

type ExecBody = {
  ok?: unknown; exitCode?: unknown; error?: unknown; stdout?: unknown; stderr?: unknown; correlationId?: unknown;
};

function bytesOf(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value) : 0;
}

for (const command of profile.commands) {
  test(`coven ${command} through the exec route answers within its production p95 budget`, async ({
    request, baseURL,
  }, testInfo) => {
    test.setTimeout(20 * 60_000);
    if (!baseURL || !process.env.CAVE_DOCTOR_ARTIFACT_ROOT) throw new Error("Missing benchmark invocation");
    const artifactRoot = process.env.CAVE_DOCTOR_ARTIFACT_ROOT;
    const control = process.env.CAVE_DOCTOR_CONTROL === "1";
    const marker = process.env.CAVE_DOCTOR_CONTROL_MARKER;
    if (control && !marker) throw new Error("The control needs its stall marker path");
    const limitMs = doctorExecLimitMs(command);
    const samples: Array<DoctorExecSample & { error?: string; cleanup?: boolean; stalled?: boolean }> = [];
    const report = {
      invocation: JSON.parse(readFileSync(path.join(artifactRoot, "invocation.json"), "utf8")),
      buildId: readFileSync(path.join(process.cwd(), ".next/BUILD_ID"), "utf8").trim(),
      profile, command, control, limitMs, samples,
      measurement: `Wall clock of POST ${profile.route} {"command":"${command}"} from request start to parsed JSON body, ` +
        "sequential, after one untimed prime. The ceiling is the route's own EXEC_TIMEOUT_MS.",
      limitations: [
        "Production standalone server on loopback with an isolated synthetic home: no engine, no daemon, no real profile",
        "The pinned released CLI the invocation records is what runs; its doctor reports and exits 1 in that home",
        "Measured through Playwright's request fixture in the same process as the test, not from a browser or the chat UI",
        "Output text is not retained (it names local paths); only byte counts and the exit code are",
      ],
      verdict: evaluateDoctorExecPerformance(command, samples),
    };
    const output = path.join(artifactRoot, `${command}.json`);
    const save = () => {
      report.verdict = evaluateDoctorExecPerformance(command, samples);
      writeFileSync(output, JSON.stringify(report, null, 2));
    };
    const exec = async (timeoutMs: number) => {
      const started = performance.now();
      const response = await request.post(profile.route, { data: { command }, timeout: timeoutMs });
      const body = (await response.json()) as ExecBody;
      const wallMs = performance.now() - started;
      const header = response.headers()[DAEMON_DIAGNOSTIC_CORRELATION_HEADER.toLowerCase()];
      return { response, body, wallMs, header };
    };
    const setStall = (stalled: boolean) => {
      if (!marker) return;
      if (stalled) writeFileSync(marker, "stall\n");
      else rmSync(marker, { force: true });
    };
    try {
      // Prime: the first request pays route and CLI first-run costs and is not
      // graded. It must prove the CLI is reachable at all, otherwise every
      // graded trial would be the same spawn failure dressed as a fast run.
      setStall(false);
      const primer = await exec(limitMs * 2 + 5_000);
      if (primer.response.status() !== 200 || !Number.isInteger(primer.body.exitCode)) {
        throw new Error(`Prime did not run the CLI: status ${primer.response.status()} ${JSON.stringify({
          ok: primer.body.ok, error: primer.body.error, exitCode: primer.body.exitCode,
        })}`);
      }

      for (let index = 0; index < profile.trials; index++) {
        const stalled = control && index < profile.controlTrials;
        const sample: typeof samples[number] = {
          index, command, complete: false, status: 0, correlated: false, ok: false, exitCode: null,
          timedOut: false, stdoutBytes: 0, stderrBytes: 0, wallMs: NaN, stalled,
        };
        samples.push(sample);
        try {
          setStall(stalled);
          const { response, body, wallMs, header } = await exec(limitMs * 2 + 5_000);
          const status = response.status();
          const timedOut = status === 504 || body.error === "timeout";
          Object.assign(sample, {
            status, wallMs, timedOut,
            correlated: typeof header === "string" && header.length > 0 && body.correlationId === header,
            ok: body.ok === true,
            exitCode: typeof body.exitCode === "number" && Number.isInteger(body.exitCode) ? body.exitCode : null,
            stdoutBytes: bytesOf(body.stdout), stderrBytes: bytesOf(body.stderr),
            complete: true,
          });
        } catch (error) {
          sample.error = String(error).slice(0, 1_000);
          sample.complete = false;
        } finally {
          sample.cleanup = true;
          save();
        }
        if (!sample.complete || sample.error) break;
      }
    } finally {
      setStall(false);
      save();
      await testInfo.attach(`${command}-measurements`, { path: output, contentType: "application/json" });
    }
    expect(report.verdict.failures, JSON.stringify(report.verdict)).toEqual([]);
    expect(report.verdict.pass).toBe(true);
  });
}
