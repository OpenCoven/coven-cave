// @ts-nocheck
//
// Regression guard for the cave-CONFIG.json write race (2026-07-03 settings
// audit). saveConfig / installMarketplacePlugin / uninstallMarketplacePlugin /
// upsertRoleConfig each did an unserialized load→merge→writeJsonAtomic. The
// Settings surface fires overlapping config PATCHes (palette-by-familiar loops,
// daemon + add-on toggles), so two in-flight writes both read the same snapshot
// and the second dropped the first patch's field.
//
// The fix is an in-process config mutex (withConfigLock in cave-config.ts),
// mirroring the state mutex. This test fires several concurrent config writes
// touching DIFFERENT top-level fields and asserts EVERY one survived — without
// the mutex at least one field reverts.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "cave-config-write-race-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");

try {
  // Two writers touching distinct fields, fired together — the classic clobber.
  await Promise.all([
    config.saveConfig({ addons: { github: true } }),
    config.saveConfig({ defaults: { harness: "codex" } }),
  ]);
  let cfg = await config.loadConfig();
  assert.equal(cfg.addons.github, true, "the addons write survived a concurrent defaults write");
  assert.equal(cfg.defaults.harness, "codex", "the defaults write survived a concurrent addons write");

  // Wider fan-out across all four writers + distinct fields simultaneously.
  await Promise.all([
    config.saveConfig({ addons: { browser: true } }),
    config.saveConfig({ familiars: { nova: { color: "#abcdef" } } }),
    config.installMarketplacePlugin("plug-a", "1.0.0", "test"),
    config.upsertRoleConfig("role-x", "nova", true),
  ]);
  cfg = await config.loadConfig();
  assert.equal(cfg.addons.github, true, "earlier addons.github still present after fan-out");
  assert.equal(cfg.addons.browser, true, "addons.browser write survived the fan-out");
  assert.equal(cfg.familiars.nova?.color, "#abcdef", "familiar color write survived the fan-out");
  assert.ok(cfg.marketplace.installed["plug-a"], "marketplace install survived the fan-out");
  assert.ok(cfg.roles.some((r) => r.id === "role-x" && r.familiar === "nova" && r.active), "role upsert survived the fan-out");

  // install then uninstall the same plugin concurrently with an unrelated save —
  // the unrelated field must not be lost regardless of install/uninstall order.
  await Promise.all([
    config.saveConfig({ addons: { code: true } }),
    config.uninstallMarketplacePlugin("plug-a"),
  ]);
  cfg = await config.loadConfig();
  assert.equal(cfg.addons.code, true, "unrelated addons write survived a concurrent uninstall");
  assert.equal(cfg.marketplace.installed["plug-a"], undefined, "uninstall took effect");

  console.log("cave-config-write-race: ok");
} finally {
  process.env.HOME = previousHome;
}
