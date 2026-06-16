// @ts-nocheck
import assert from "node:assert/strict";
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
  });

  const installedAt = await config.installMarketplacePlugin("github", "0.1.0", "catalog");
  assert.ok(Number.isFinite(Date.parse(installedAt)));

  let cfg = await config.loadConfig();
  assert.equal(cfg.marketplace.installed.github.version, "0.1.0");
  assert.equal(cfg.marketplace.installed.github.source, "catalog");
  assert.equal(cfg.marketplace.installed.github.installedAt, installedAt);

  await config.uninstallMarketplacePlugin("github");
  cfg = await config.loadConfig();
  assert.deepEqual(cfg.marketplace.installed, {});

  await config.saveConfig({
    familiars: {
      nova: {
        harness: "claude",
        model: "anthropic/claude-sonnet-4-6",
        voiceProvider: "openai",
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
    display_name: "Nova Prime",
    role: "review familiar",
  });

  const novaBinding = config.bindingFor(cfg, "nova");
  assert.equal(novaBinding.display_name, "Nova Prime");
  assert.equal(novaBinding.role, "review familiar");

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
