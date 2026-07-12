// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "cave-config-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");

try {
  assert.deepEqual(await config.loadState(), {
    sessionFamiliar: {},
    sessionTitles: {},
    sessionArchived: {},
    sessionSacrificed: {},
    sessionOwned: {},
    mergedPrAutoArchived: {},
    travel: {
      manualOffline: false,
      hubUnreachableSince: null,
      lastHubReachableAt: null,
      staleCache: false,
      localSubdaemonWakeRequestedAt: null,
      localBindHost: "127.0.0.1",
      offlineQueue: [],
    },
  });

  await config.recordSessionFamiliar("session-1", "cody");
  assert.equal(await config.setSessionTitle("session-1", "  Renamed session  "), "Renamed session");

  const archivedAt = await config.archiveSessionLocal("session-1");
  assert.ok(Number.isFinite(Date.parse(archivedAt)));

  let state = await config.loadState();
  assert.deepEqual(state.sessionFamiliar, { "session-1": "cody" });
  assert.deepEqual(state.sessionTitles, { "session-1": "Renamed session" });
  assert.equal(state.sessionArchived["session-1"], archivedAt);
  assert.deepEqual(state.sessionSacrificed, {});

  await config.summonSessionLocal("session-1");
  state = await config.loadState();
  assert.deepEqual(state.sessionArchived, {});

  // Merged-PR auto-archive: archives + records the one-shot (session, PR) pair,
  // and summoning afterwards clears the archive but keeps the record.
  const mergedAt = await config.archiveSessionsForMergedPrs([
    { sessionId: "session-1", prKey: "OpenCoven/coven-cave#42" },
  ]);
  state = await config.loadState();
  assert.equal(state.sessionArchived["session-1"], mergedAt);
  assert.deepEqual(state.mergedPrAutoArchived, { "session-1": "OpenCoven/coven-cave#42" });
  await config.summonSessionLocal("session-1");
  state = await config.loadState();
  assert.deepEqual(state.sessionArchived, {});
  assert.deepEqual(state.mergedPrAutoArchived, { "session-1": "OpenCoven/coven-cave#42" });

  assert.equal(await config.setSessionTitle("session-1", "  "), null);
  state = await config.loadState();
  assert.deepEqual(state.sessionTitles, {});

  const sacrificedAt = await config.sacrificeSessionLocal("session-1");
  assert.ok(Number.isFinite(Date.parse(sacrificedAt)));

  const raw = await readFile(path.join(tempHome, ".coven", "cave-state.json"), "utf8");
  assert.deepEqual(JSON.parse(raw), {
    sessionFamiliar: { "session-1": "cody" },
    sessionTitles: {},
    sessionArchived: {},
    sessionSacrificed: { "session-1": sacrificedAt },
    sessionOwned: {},
    mergedPrAutoArchived: { "session-1": "OpenCoven/coven-cave#42" },
    travel: {
      manualOffline: false,
      hubUnreachableSince: null,
      lastHubReachableAt: null,
      staleCache: false,
      localSubdaemonWakeRequestedAt: null,
      localBindHost: "127.0.0.1",
      offlineQueue: [],
    },
  });

  const installedAt = await config.installMarketplacePlugin("github", "0.1.0", "catalog");
  assert.ok(Number.isFinite(Date.parse(installedAt)));

  let cfg = await config.loadConfig();
  assert.deepEqual(cfg.multiHost, {
    mode: "local",
    hubUrl: "",
    executorUrls: [],
  });
  assert.equal(cfg.marketplace.installed.github.version, "0.1.0");
  assert.equal(cfg.marketplace.installed.github.source, "catalog");
  assert.equal(cfg.marketplace.installed.github.installedAt, installedAt);
  assert.equal(cfg.marketplace.installed.github.runtime, undefined, "legacy install entries remain valid");

  const craftVerifiedAt = "2026-07-09T23:30:00.000Z";
  await config.installMarketplacePlugin("seekers-lens", "0.1.0", "catalog", {
    runtime: "codex",
    verifiedAt: craftVerifiedAt,
    craftVersion: "0.1.0",
  });
  cfg = await config.loadConfig();
  assert.equal(cfg.marketplace.installed["seekers-lens"].runtime, "codex");
  assert.equal(cfg.marketplace.installed["seekers-lens"].verifiedAt, craftVerifiedAt);
  assert.equal(cfg.marketplace.installed["seekers-lens"].craftVersion, "0.1.0");

  await config.uninstallMarketplacePlugin("github");
  cfg = await config.loadConfig();
  assert.deepEqual(Object.keys(cfg.marketplace.installed), ["seekers-lens"]);
  await config.uninstallMarketplacePlugin("seekers-lens");

  await config.saveConfig({
    multiHost: {
      mode: "hub",
      hubUrl: "  server.tailnet:8787  ",
      executorUrls: ["  macbook.tailnet:8787  ", "", "macbook.tailnet:8787", "linux.tailnet:8787"],
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.multiHost, {
    mode: "hub",
    hubUrl: "server.tailnet:8787",
    executorUrls: ["macbook.tailnet:8787", "linux.tailnet:8787"],
  });

  await config.saveConfig({
    familiars: {
      nova: {
        harness: "claude",
        model: "anthropic/claude-sonnet-4-6",
        voiceProvider: "openai",
        autoSelfReport: true,
      },
    },
  });
  await config.saveConfig({
    familiars: {
      nova: {
        display_name: "Nova Prime",
        role: "review familiar",
      },
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.familiars.nova, {
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    voiceProvider: "openai",
    autoSelfReport: true,
    display_name: "Nova Prime",
    role: "review familiar",
  });

  const novaBinding = config.bindingFor(cfg, "nova");
  assert.equal(novaBinding.display_name, "Nova Prime");
  assert.equal(novaBinding.role, "review familiar");
  assert.equal(novaBinding.autoSelfReport, true);
  assert.equal(config.bindingFor(cfg, "missing").autoSelfReport, false);

  await config.saveConfig({
    familiars: {
      nova: {
        voiceProvider: null,
      },
    },
  });
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.familiars.nova, {
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    autoSelfReport: true,
    display_name: "Nova Prime",
    role: "review familiar",
  });

  await config.saveConfig({ familiars: { nova: null } });
  cfg = await config.loadConfig();
  assert.equal(cfg.familiars.nova, undefined);
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
}

// ── Config write-race mutex (2026-07-03 settings audit) ──────────────────────
// All four cave-config.json writers serialize their read-modify-write through
// one in-process lock, mirroring the state mutex — otherwise concurrent PATCHes
// clobber each other's fields.
{
  const src = fs.readFileSync(new URL("./cave-config.ts", import.meta.url), "utf8");
  assert.match(src, /async function withConfigLock<T>/, "cave-config has a config mutex helper");
  assert.equal((src.match(/return withConfigLock\(async \(\) => \{/g) || []).length, 4, "all four config writers run under the lock");
}
