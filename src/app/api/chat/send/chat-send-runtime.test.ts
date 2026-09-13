import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  filterUsableLocalDirectories,
  shouldRetryBlankCopilotResume,
} from "./chat-send-runtime.ts";

test("stale project grants never reach local harness launch arguments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-chat-grants-"));
  try {
    const liveDirectory = path.join(root, "live");
    const ordinaryFile = path.join(root, "not-a-directory");
    const missingDirectory = path.join(root, "deleted");
    await mkdir(liveDirectory);
    await writeFile(ordinaryFile, "not a grant root");

    assert.deepEqual(
      await filterUsableLocalDirectories([
        ` ${liveDirectory} `,
        missingDirectory,
        ordinaryFile,
        "",
        liveDirectory,
      ]),
      [liveDirectory],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Chat derives effective grants from usable local directories", async () => {
  const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /filterUsableLocalDirectories\([\s\S]*?accessibleProjects\.map\(\(entry\) => entry\.project\.root\)/,
  );
  assert.match(
    route,
    /effectiveAccessibleProjects[\s\S]*?const grantedProjectRoots = effectiveAccessibleProjects\.map/,
  );
});

test("automatic journal generation cannot launch an external credential provider", async () => {
  const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /surfaceOrigin === "journal" && body\.credentialMode === "passive"[\s\S]*?passiveHarnessSpawnEnv\(familiarId, discovery\)[\s\S]*?: harnessSpawnEnv\(familiarId, discovery\)/,
  );
  assert.match(route, /prepareOpenCodeEnv\(scopedSpawnEnv\(body\.familiarId\)\)/, "OpenCode honors the same passive policy before runtime normalization");
  assert.match(route, /openClawSpawnEnv\(\{ credentialMode: args\.credentialMode \}\)/, "OpenClaw fallback honors the validated journal policy");
  assert.match(route, /credentialMode: usePassiveCredentials \? "passive" : undefined/, "only the validated journal boundary selects passive credentials");
});

test("blank resumed Copilot attempts retry for silent zero and nonzero exits", () => {
  const resumedBlankAttempt = {
    hasCopilotStream: true,
    resumeTarget: "copilot-session",
    runtimeAccessRefreshNeeded: false,
    inferenceRouteRefreshNeeded: false,
    stopRequested: false,
    launchFailed: false,
    assistantText: "",
    durationMs: undefined,
    resultIsError: undefined,
  };

  assert.equal(shouldRetryBlankCopilotResume(resumedBlankAttempt), true);
  assert.equal(
    shouldRetryBlankCopilotResume({ ...resumedBlankAttempt, resultIsError: true }),
    true,
    "a blank resumed nonzero exit receives the same bounded fresh-session retry",
  );
});

test("blank Copilot resume retry preserves every existing boundary", () => {
  const resumedBlankAttempt = {
    hasCopilotStream: true,
    resumeTarget: "copilot-session",
    runtimeAccessRefreshNeeded: false,
    inferenceRouteRefreshNeeded: false,
    stopRequested: false,
    launchFailed: false,
    assistantText: "",
    durationMs: undefined,
    resultIsError: true,
  };
  const excludedAttempts = [
    { name: "non-Copilot route", input: { hasCopilotStream: false } },
    { name: "fresh conversation", input: { resumeTarget: null } },
    { name: "access refresh", input: { runtimeAccessRefreshNeeded: true } },
    { name: "inference-route refresh", input: { inferenceRouteRefreshNeeded: true } },
    { name: "stopped run", input: { stopRequested: true } },
    { name: "launch failure", input: { launchFailed: true } },
    { name: "assistant response", input: { assistantText: "visible answer" } },
    { name: "result duration", input: { durationMs: 10 } },
    { name: "explicit successful result", input: { resultIsError: false } },
  ] as const;

  for (const excluded of excludedAttempts) {
    assert.equal(
      shouldRetryBlankCopilotResume({ ...resumedBlankAttempt, ...excluded.input }),
      false,
      excluded.name,
    );
  }
});

test("Chat routes blank resumed Copilot attempts through the bounded retry predicate", async () => {
  const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    route,
    /shouldRetryBlankCopilotResume\(\{[\s\S]*?hasCopilotStream: Boolean\(copilotStream\),[\s\S]*?resumeTarget,[\s\S]*?durationMs: result\.duration_ms,[\s\S]*?resultIsError: result\.is_error,[\s\S]*?resumeFailed = true/,
  );
});
