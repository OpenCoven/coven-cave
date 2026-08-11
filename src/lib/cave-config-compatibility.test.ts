// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "cave-config-compatibility-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");
const caveDir = path.join(tempHome, ".coven", "cave");
const configPath = path.join(caveDir, "config.json");
const statePath = path.join(caveDir, "state.json");

try {
  await mkdir(caveDir, { recursive: true });

  const newerConfig = '{"version":2,"defaults":{"harness":"claude"}}\n';
  await writeFile(configPath, newerConfig);
  await assert.rejects(
    config.loadConfig(),
    (error) => error?.code === "unsupported_cave_config_version",
    "a newer config must fail closed",
  );
  await assert.rejects(
    config.saveConfig({ addons: { github: true } }),
    (error) => error?.code === "unsupported_cave_config_version",
    "a settings write must never replace a newer config with defaults",
  );
  assert.equal(await readFile(configPath, "utf8"), newerConfig, "newer config bytes remain untouched");

  const invalidConfig = '{not-json\n';
  await writeFile(configPath, invalidConfig);
  await assert.rejects(
    config.loadConfig(),
    (error) => error?.code === "invalid_cave_config",
    "malformed config must be actionable rather than silently defaulted",
  );
  assert.equal(await readFile(configPath, "utf8"), invalidConfig, "malformed config is preserved for recovery");

  await writeFile(configPath, '{"version":1}\n');
  const invalidState = '{not-json\n';
  await writeFile(statePath, invalidState);
  await assert.rejects(
    config.loadState(),
    (error) => error?.code === "invalid_cave_state",
    "malformed state must not become an empty session state",
  );
  await config.recordSessionFamiliar("session-1", "cody");
  assert.equal(await readFile(statePath, "utf8"), invalidState, "best-effort session writes do not overwrite invalid state");

  console.log("cave-config-compatibility.test.ts: ok");
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await rm(tempHome, { recursive: true, force: true });
}
