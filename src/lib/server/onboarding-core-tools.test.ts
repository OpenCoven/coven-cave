import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureOnboardingCoreTools,
  runReviewedInstall,
  type OnboardingCoreToolsDependencies,
  type OnboardingCoreToolsInspection,
} from "./onboarding-core-tools.ts";

function inspection(
  managedNode: OnboardingCoreToolsInspection["components"]["managedNode"],
  covenCli: OnboardingCoreToolsInspection["components"]["covenCli"],
): OnboardingCoreToolsInspection {
  return {
    runtimeReady: managedNode === "ready",
    coreToolsReady: covenCli === "ready",
    components: { managedNode, covenCli },
  };
}

function dependencies(
  overrides: Partial<OnboardingCoreToolsDependencies> = {},
): OnboardingCoreToolsDependencies {
  let now = 0;
  return {
    platform: "linux",
    inspect: async () => inspection("ready", "ready"),
    startInstall: async () => ({
      status: 202,
      body: { status: "started", started: true },
    }),
    readInstall: () => ({ status: "done", ok: true, code: 0, tail: "ready" }),
    probeManagedNodeWrite: async () => ({ exists: true, writeProbe: "passed" }),
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    ...overrides,
  };
}

function inspectionSequence(
  values: OnboardingCoreToolsInspection[],
): () => Promise<OnboardingCoreToolsInspection> {
  let index = 0;
  return async () => values[Math.min(index++, values.length - 1)]!;
}

test("existing verified components remain skipped without starting an installer", async () => {
  let starts = 0;
  const result = await ensureOnboardingCoreTools(async () => undefined, dependencies({
    startInstall: async () => {
      starts += 1;
      return { status: 202, body: { status: "started", started: true } };
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    detail: "Existing local components were verified.",
  });
  assert.equal(starts, 0);
});

test("managed Node and the Coven CLI install through the reviewed serialized lane", async () => {
  const starts: string[] = [];
  const progress: string[] = [];
  const result = await ensureOnboardingCoreTools(
    async (detail) => {
      progress.push(detail);
    },
    dependencies({
      inspect: inspectionSequence([
        inspection("missing", "missing"),
        inspection("ready", "missing"),
        inspection("ready", "ready"),
      ]),
      startInstall: async (target) => {
        starts.push(target);
        return { status: 202, body: { status: "started", started: true } };
      },
    }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(starts, ["managed-node", "coven-cli"]);
  assert.deepEqual(progress, [
    "Preparing Cave’s local runtime…",
    "Preparing Cave’s core components…",
    "Verifying Cave’s local components…",
  ]);
});

test("only a failed real Cave-owned write probe reports application-data writeability", async () => {
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("missing", "missing"),
        inspection("unusable", "missing"),
      ]),
      readInstall: () => ({
        status: "done",
        ok: false,
        failureCode: "filesystem_failed",
        tail: "EACCES while renaming the managed runtime",
      }),
      probeManagedNodeWrite: async () => ({ exists: true, writeProbe: "failed" }),
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "application_data_not_writable");
  assert.equal(result.diagnostics?.applicationData.writeProbe, "failed");
  assert.match(result.message, /application-data folder/);
});

test("download failure is never relabeled or followed by an unrelated write probe", async () => {
  let probes = 0;
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("missing", "missing"),
        inspection("missing", "missing"),
      ]),
      readInstall: () => ({
        status: "done",
        ok: false,
        failureCode: "download_failed",
        tail: "network request failed",
      }),
      probeManagedNodeWrite: async () => {
        probes += 1;
        return { exists: true, writeProbe: "failed" };
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "download_failed");
  assert.equal(probes, 0);
  assert.equal(result.diagnostics?.applicationData.writeProbe, "not_run");
  assert.match(result.message, /download/);
  assert.doesNotMatch(result.message, /couldn’t write/i);
});

for (const code of ["integrity_check_failed", "archive_failed"] as const) {
  test(`${code} remains a distinct server-classified recovery`, async () => {
    const result = await ensureOnboardingCoreTools(
      async () => undefined,
      dependencies({
        inspect: inspectionSequence([
          inspection("missing", "missing"),
          inspection("unusable", "missing"),
        ]),
        readInstall: () => ({ status: "done", ok: false, failureCode: code }),
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
  });
}

test("continuous 409 responses settle as bounded install_busy", async () => {
  let starts = 0;
  const result = await runReviewedInstall("managed-node", dependencies({
    startInstall: async () => {
      starts += 1;
      return {
        status: 409,
        body: {
          status: "busy",
          failureCode: "install_busy",
          code: "npm_install_in_progress",
        },
      };
    },
  }));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "install_busy");
  assert.ok(starts > 0 && starts <= 1_000, "busy polling is deadline-bounded");
});

test("a running install that exceeds the observer deadline is a timeout", async () => {
  const result = await runReviewedInstall("managed-node", dependencies({
    readInstall: () => ({ status: "running", elapsedMs: 1 }),
  }));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "install_timeout");
});

for (const scenario of ["busy", "timeout"] as const) {
  test(`${scenario} observers never probe a toolchain owned by the active lane`, async () => {
    let probes = 0;
    const result = await ensureOnboardingCoreTools(
      async () => undefined,
      dependencies({
        inspect: inspectionSequence([
          inspection("missing", "missing"),
          inspection("missing", "missing"),
        ]),
        startInstall:
          scenario === "busy"
            ? async () => ({
                status: 409,
                body: {
                  status: "busy",
                  failureCode: "install_busy",
                  code: "npm_install_in_progress",
                },
              })
            : async () => ({
                status: 202,
                body: { status: "started", started: true },
              }),
        readInstall: () => ({ status: "running", elapsedMs: 1 }),
        probeManagedNodeWrite: async () => {
          probes += 1;
          return { exists: true, writeProbe: "failed" };
        },
      }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, scenario === "busy" ? "install_busy" : "install_timeout");
      assert.equal(result.diagnostics?.applicationData.writeProbe, "not_run");
    }
    assert.equal(probes, 0);
  });
}

test("post-install readiness failure remains verification_failed", async () => {
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("missing", "ready"),
        inspection("ready", "ready"),
        inspection("ready", "unusable"),
      ]),
    }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "verification_failed");
});

test("a host Coven CLI failure never probes or blames Cave application data", async () => {
  let probes = 0;
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("ready", "missing"),
        inspection("ready", "unusable"),
      ]),
      readInstall: () => ({
        status: "done",
        ok: false,
        failureCode: "filesystem_failed",
        tail: "EPERM in a host npm prefix",
      }),
      probeManagedNodeWrite: async () => {
        probes += 1;
        return { exists: true, writeProbe: "failed" };
      },
    }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "filesystem_failed");
  assert.equal(probes, 0);
  assert.equal(result.ok ? null : result.diagnostics?.applicationData.writeProbe, "not_run");
});

test("daemon lifecycle failures remain local-service diagnostics", async () => {
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("ready", "missing"),
        inspection("ready", "unusable"),
      ]),
      readInstall: () => ({
        status: "done",
        ok: false,
        code: 1,
        failureCode: "local_service_failed",
        tail: "local daemon recovery failed",
      }),
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "local_service_failed");
  assert.equal(result.diagnostics?.components.localService, "not_ready");
  assert.match(result.message, /local service/i);
});

test("an executable lock remains a busy recovery category", async () => {
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("ready", "missing"),
        inspection("ready", "unusable"),
      ]),
      readInstall: () => ({
        status: "done",
        ok: false,
        code: 1,
        failureCode: "install_busy",
        tail: "EBUSY: coven.exe is locked",
      }),
    }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "install_busy");
});

test("unknown installer errors are bounded and sanitized before bootstrap persistence", async () => {
  const result = await ensureOnboardingCoreTools(
    async () => undefined,
    dependencies({
      inspect: inspectionSequence([
        inspection("missing", "missing"),
        inspection("unusable", "missing"),
      ]),
      readInstall: () => ({
        status: "done",
        ok: false,
        failureCode: "unknown_failure",
        tail: "token=super-secret\n/home/sage/private/tool failed with EUNKNOWN",
      }),
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  const serialized = JSON.stringify(result.diagnostics);
  assert.doesNotMatch(serialized, /super-secret|\/home\/sage/);
  assert.match(serialized, /EUNKNOWN/);
});

console.log("onboarding-core-tools.test.ts: ok");
