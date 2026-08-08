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
