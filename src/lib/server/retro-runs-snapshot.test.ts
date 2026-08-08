// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRetroRunsSnapshot } from "./retro-runs-snapshot.ts";

const RETRO_CONFIG = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: {},
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

test("retro loader reports a stable failure without exposing the daemon error", async () => {
  const result = await loadRetroRunsSnapshot({
    familiarId: "sage",
    dependencies: {
      loadConfig: async () => RETRO_CONFIG,
      callDaemon: async () => ({ ok: false, status: 503, error: "token=/secret/path" }),
    },
  });

  assert.deepEqual(result, {
    ok: false,
    code: "retro_roster_unavailable",
    error: result.error,
    snapshot: {
      generatedAt: result.snapshot.generatedAt,
      summary: {
        totalRuns: 0,
        accepted: 0,
        reverted: 0,
        runningFamiliars: 0,
        familiarsWithData: 0,
        trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
        lastRun: null,
      },
      familiars: [],
      runs: [],
    },
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("/secret/path"), false);
});

test("retro loader fetches only the requested familiar state", async () => {
  const paths: string[] = [];
  const result = await loadRetroRunsSnapshot({
    familiarId: "sage",
    dependencies: {
      loadConfig: async () => RETRO_CONFIG,
      callDaemon: async ({ path }) => {
        paths.push(path);
        if (path === "/api/v1/familiars") {
          return {
            ok: true,
            status: 200,
            data: [
              { id: "sage", display_name: "Sage", role: "Researcher" },
              { id: "moss", display_name: "Moss", role: "Builder" },
            ],
          };
        }
        return {
          ok: true,
          status: 200,
          data: { ok: true, state: { familiar_id: "sage", iterations: [] } },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(paths, ["/api/v1/familiars", "/api/v1/skills/eval-loop/sage"]);
  assert.equal(result.snapshot.familiars.length, 1);
  assert.equal(result.snapshot.familiars[0].familiarId, "sage");
});

test("retro loader normalizes unavailable familiar state to a stable code", async () => {
  const result = await loadRetroRunsSnapshot({
    familiarId: "sage",
    dependencies: {
      loadConfig: async () => RETRO_CONFIG,
      callDaemon: async ({ path }) =>
        path === "/api/v1/familiars"
          ? {
              ok: true,
              status: 200,
              data: [{ id: "sage", display_name: "Sage", role: "Researcher" }],
            }
          : {
              ok: false,
              status: 503,
              error: "daemon refused token=/secret/path",
            },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "retro_state_unavailable");
  assert.equal(result.error, "One or more retro states are unavailable.");
  assert.equal(result.snapshot.familiars.length, 1);
  assert.deepEqual(result.snapshot.familiars[0].raw, {
    familiar_id: "sage",
    last_run: null,
    iterations: [],
    track_counts: { synthesis: 0, prompt: 0, memory: 0 },
    total_accepted: 0,
    total_reverted: 0,
    running: false,
    unavailable: "retro_state_unavailable",
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("/secret/path"), false);
});
