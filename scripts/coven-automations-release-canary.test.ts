import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseCanaryArguments,
  pinnedReleaseVersion,
  RELEASE_FIXTURE,
  REQUIRED_ACTIONS,
  runCaveAutomationsScenario,
  type CanaryDependencies,
  type CanaryHistory,
  type CanaryResponse,
  type CanaryRoutine,
} from "./coven-automations-release-canary.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class CovenAutomationsUnavailableError extends Error {
  readonly degraded: boolean;
  constructor(message: string, degraded: boolean) {
    super(message);
    this.name = "CovenAutomationsUnavailableError";
    this.degraded = degraded;
  }
}

interface Flaws {
  missingAction?: string;
  createsActive?: boolean;
  refusalLooksOffline?: boolean;
  forgetsUpdateOnRestart?: boolean;
  deleteNotIdempotent?: boolean;
  checkpointRewinds?: boolean;
  fallsBackWhenStopped?: boolean;
  offlineHistoryLooksAvailable?: boolean;
  formCreatedActive?: boolean;
  formRuleRefused?: boolean;
  localZoneUnresolved?: boolean;
  replayReapplies?: boolean;
  staleRevisionOverwrites?: boolean;
  offlineLifecycleLooksAvailable?: boolean;
}

const labels: Record<string, string> = {
  created: "Definition created", revised: "Definition revised", removed: "Definition removed",
};

/** An in-memory stand-in for the daemon as Cave's client and history route report it. */
function fakeCave(flaws: Flaws = {}): CanaryDependencies {
  let routine: CanaryRoutine | null = null;
  let previous: CanaryRoutine | null = null;
  let revision = 0;
  let offline = false;
  const events: { sequence: number; label: string; detail: string }[] = [];
  const record = (kind: string) => {
    revision += 1;
    events.push({ sequence: events.length, label: labels[kind] ?? kind, detail: `Revision ${revision}` });
  };
  // The second routine, created through Cave's create route and driven by the lifecycle routes.
  let form: { state: "paused" | "active"; revision: number } | null = null;
  const adopted = new Map<string, number>();
  const formRecord = (id: string) => form === null
    ? { id, kind: "absent" }
    : { id, kind: "present", state: form.state, revision: form.revision, timezone: flaws.localZoneUnresolved === true ? "local" : "Etc/UTC" };
  const online = () => {
    if (offline && flaws.fallsBackWhenStopped !== true) {
      throw new CovenAutomationsUnavailableError("daemon request failed: connect ENOENT", true);
    }
  };
  return {
    capabilities: () => Promise.resolve({
      status: "available",
      actions: REQUIRED_ACTIONS.filter((action) => action !== flaws.missingAction),
    }),
    createRoutine: (draft) => {
      online();
      if (!/^[A-Za-z0-9_.-]+$/u.test(String(draft.id))) {
        return Promise.reject(new CovenAutomationsUnavailableError("id may contain only ASCII letters", flaws.refusalLooksOffline === true));
      }
      routine = { ...(draft as unknown as CanaryRoutine), ...(flaws.createsActive === true ? { status: "ACTIVE" } : {}) };
      record("created");
      return Promise.resolve({ ...routine });
    },
    getRoutine: () => {
      online();
      return Promise.resolve(routine === null ? null : { ...routine });
    },
    listRoutines: () => Promise.resolve(routine === null ? [] : [{ ...routine }]),
    updateRoutine: (definition) => {
      previous = routine;
      routine = { ...(definition as CanaryRoutine) };
      record("revised");
      return Promise.resolve({ ...routine });
    },
    listRoutineRuns: () => Promise.resolve([]),
    deleteRoutine: (id) => {
      if (id === "cave-release-canary-form") {
        const existed = form !== null;
        form = null;
        return Promise.resolve(existed);
      }
      const existed = routine !== null;
      if (existed) record("removed");
      routine = null;
      return Promise.resolve(existed || flaws.deleteNotIdempotent === true);
    },
    history: (_id, checkpoint): Promise<CanaryHistory> => {
      if (offline && flaws.offlineHistoryLooksAvailable !== true) {
        return Promise.resolve({ status: 503, body: { kind: "unavailable" } });
      }
      const after = checkpoint === undefined || flaws.checkpointRewinds === true ? -1 : Number(checkpoint.slice(3));
      const entries = events.filter((event) => event.sequence > after);
      const last = entries.at(-1)?.sequence ?? after;
      return Promise.resolve({
        status: 200,
        body: { kind: "available", entries, hasEntries: entries.length > 0, checkpoint: `cp:${last}` },
      });
    },
    createRoutineViaRoute: (body): Promise<CanaryResponse> => {
      if (flaws.formRuleRefused === true && /BYMINUTE/u.test(String(body.rrule))) {
        return Promise.resolve({ status: 500, body: { ok: false, error: "rrule key `BYMINUTE` is not supported" } });
      }
      form = { state: flaws.formCreatedActive === true ? "active" : "paused", revision: 1 };
      return Promise.resolve({ status: 200, body: { ok: true, automation: { id: body.id, status: form.state === "active" ? "ACTIVE" : "PAUSED" } } });
    },
    lifecycle: (ids): Promise<CanaryResponse> => {
      if (offline && flaws.offlineLifecycleLooksAvailable !== true) return Promise.resolve({ status: 503, body: { kind: "unavailable" } });
      return Promise.resolve({ status: 200, body: { kind: "available", readAt: "2026-10-18T00:00:00.000Z", records: ids.map((id) =>
        id === "cave-release-canary"
          ? routine === null ? { id, kind: "absent" } : { id, kind: "present", state: routine.status === "ACTIVE" ? "active" : "paused", revision, timezone: routine.timezone }
          : formRecord(id)) } });
    },
    lifecycleDetail: (id): Promise<CanaryResponse> => Promise.resolve({ status: 200, body: {
      kind: "available", readAt: "2026-10-18T00:00:00.000Z", record: formRecord(id),
      health: { nextDueAt: "2026-10-18T15:00:00.000Z", lastPlannedAt: null, lastStartedAt: null, lastSuccessAt: null, consecutiveFailures: 0, quarantined: false },
    } }),
    lifecycleCommand: (_id, body): Promise<CanaryResponse> => {
      if (offline) return Promise.resolve({ status: 503, body: { kind: "unavailable" } });
      const key = String(body.adoptionKey);
      if (adopted.has(key) && flaws.replayReapplies !== true) {
        return Promise.resolve({ status: 200, body: { kind: "committed", revision: adopted.get(key), replayed: true } });
      }
      if (form === null) return Promise.resolve({ status: 422, body: { kind: "rejected", code: "NOT_FOUND" } });
      if (body.expectedRevision !== form.revision && flaws.staleRevisionOverwrites !== true) {
        return Promise.resolve({ status: 409, body: { kind: "conflict", currentRevision: form.revision } });
      }
      form = { state: body.command === "activate" ? "active" : "paused", revision: form.revision + 1 };
      adopted.set(key, form.revision);
      return Promise.resolve({ status: 200, body: { kind: "committed", revision: form.revision, replayed: false } });
    },
    restartDaemon: () => {
      if (flaws.forgetsUpdateOnRestart === true) routine = previous;
      return Promise.resolve();
    },
    stopDaemon: () => {
      offline = true;
      return Promise.resolve();
    },
  };
}

test("parses an optional coven path, with or without the pnpm separator", () => {
  assert.deepEqual(parseCanaryArguments([]), {});
  assert.deepEqual(parseCanaryArguments(["--", "--coven", "bin/coven.js"]), { coven: path.resolve("bin/coven.js") });
  for (const argv of [["--coven"], ["--coven", "--other"], ["--coven", "a", "--coven", "b"], ["--expect-version", "0.4.8"]]) {
    assert.throws(() => parseCanaryArguments(argv), /^Error: usage:/u, JSON.stringify(argv));
  }
});

test("pins one exact CLI release, at registry integrity, and CI runs the canary", () => {
  const version = pinnedReleaseVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  const lock = JSON.parse(readFileSync(path.join(RELEASE_FIXTURE, "package-lock.json"), "utf8")) as {
    lockfileVersion: number;
    packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
  };
  assert.equal(lock.lockfileVersion, 3);
  const installed = Object.entries(lock.packages).filter(([name]) => name !== "");
  assert.deepEqual(installed.map(([name]) => name).sort(), [
    "node_modules/@opencoven/cli",
    "node_modules/@opencoven/cli-linux-x64",
    "node_modules/@opencoven/cli-macos",
    "node_modules/@opencoven/cli-macos-x64",
    "node_modules/@opencoven/cli-windows",
  ]);
  for (const [name, entry] of installed) {
    const packageName = name.slice("node_modules/".length);
    assert.equal(entry.version, version, name);
    assert.equal(entry.resolved, `https://registry.npmjs.org/${packageName}/-/${packageName.split("/")[1]}-${version}.tgz`, name);
    assert.match(entry.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/u, name);
  }
  const workflow = readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /- name: Automations release canary\n\s+command: canary:automations-release\n/u);
  const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["canary:automations-release"],
    "node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/coven-automations-release-canary.ts");
});

test("passes against a daemon Cave reports faithfully", async () => {
  assert.deepEqual(await runCaveAutomationsScenario(fakeCave(), { formHour: 15 }),
    { mutations: 6, historyEntries: 3, historyPages: 3, lifecycleCommands: 4 });
});

for (const [label, flaws, message] of [
  ["a missing advertised action", { missingAction: "coven.automations.events.subscribe.v1" }, /capabilities: expected coven\.automations available with coven\.automations\.events\.subscribe\.v1/u],
  ["a create that does not stay paused", { createsActive: true }, /createRoutine: expected the paused utc routine back/u],
  ["a daemon refusal reported as an outage", { refusalLooksOffline: true }, /createRoutine with an invalid id: expected CovenAutomationsUnavailableError with degraded=false/u],
  ["a revision lost across the restart", { forgetsUpdateOnRestart: true }, /getRoutine after restart: expected the revised routine/u],
  ["a second delete that claims success", { deleteNotIdempotent: true }, /deleteRoutine again: expected false/u],
  ["a checkpoint that rewinds to the start", { checkpointRewinds: true }, /history from the pre-restart checkpoint: expected available history \[2:Definition removed:Revision 3\]/u],
  ["a read that falls back when the daemon is gone", { fallsBackWhenStopped: true }, /getRoutine with the daemon stopped: expected CovenAutomationsUnavailableError with degraded=true, but the call succeeded/u],
  ["history that looks available when the daemon is gone", { offlineHistoryLooksAvailable: true }, /history with the daemon stopped: expected 503 unavailable/u],
  ["a create from the form that does not stay paused", { formCreatedActive: true }, /create route: expected the form routine created paused/u],
  ["a create route that passes BYMINUTE to Coven", { formRuleRefused: true }, /create route: expected the form routine created paused, received 500/u],
  ["a zone left as local", { localZoneUnresolved: true }, /lifecycle: expected the explicit utc zone and a resolved zone for local/u],
  ["a resend that applies the command again", { replayReapplies: true }, /resume resent under its adoption key: expected 200/u],
  ["a stale revision that overwrites", { staleRevisionOverwrites: true }, /pause at a stale revision: expected 409/u],
  ["a lifecycle that looks available when the daemon is gone", { offlineLifecycleLooksAvailable: true }, /lifecycle with the daemon stopped: expected 503/u],
] as const) {
  test(`fails closed on ${label}`, async () => {
    await assert.rejects(runCaveAutomationsScenario(fakeCave(flaws), { formHour: 15 }), message);
  });
}
