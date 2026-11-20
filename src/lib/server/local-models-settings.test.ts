import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  EMPTY_LOCAL_MODEL_SETTINGS,
  localModelSettingsPath,
  normalizeLocalModelSettings,
  readLocalModelSettings,
  updateLocalModelSettings,
  writeLocalModelSettings,
} from "./local-models-settings.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "cave-local-models-store-"));
const savedCaveHome = process.env.COVEN_CAVE_HOME;
// A home that does not exist yet: the first save creates it.
process.env.COVEN_CAVE_HOME = path.join(scratch, "cave");
after(() => {
  if (savedCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = savedCaveHome;
  rmSync(scratch, { recursive: true, force: true });
});

test("nothing saved reads as the defaults: default addresses, no remote servers", async () => {
  assert.deepEqual(await readLocalModelSettings(), EMPTY_LOCAL_MODEL_SETTINGS);
});

test("a save round-trips and lands in Cave's home", async () => {
  await writeLocalModelSettings({ endpoints: { ollama: "http://127.0.0.1:11500" }, allowRemote: false });
  assert.equal(localModelSettingsPath(), path.join(scratch, "cave", "local-models.json"));
  assert.deepEqual(JSON.parse(readFileSync(localModelSettingsPath(), "utf8")), {
    version: 1, endpoints: { ollama: "http://127.0.0.1:11500" }, allowRemote: false,
  });
  assert.deepEqual(await readLocalModelSettings(), { endpoints: { ollama: "http://127.0.0.1:11500" }, allowRemote: false });
});

test("an unreadable or hand-edited file never widens what is allowed", async () => {
  writeFileSync(localModelSettingsPath(), "{ not json");
  assert.deepEqual(await readLocalModelSettings(), EMPTY_LOCAL_MODEL_SETTINGS);
  assert.deepEqual(normalizeLocalModelSettings({
    endpoints: { ollama: 5, lmstudio: "  http://127.0.0.1:1300  ", vllm: "http://127.0.0.1:8000" },
    allowRemote: "yes",
    extra: true,
  }), { endpoints: { lmstudio: "http://127.0.0.1:1300" }, allowRemote: false });
  for (const value of [null, [], "x", 3]) assert.deepEqual(normalizeLocalModelSettings(value), EMPTY_LOCAL_MODEL_SETTINGS);
});

test("two quick changes both land", async () => {
  await writeLocalModelSettings(EMPTY_LOCAL_MODEL_SETTINGS);
  await Promise.all([
    updateLocalModelSettings((current) => ({ settings: { ...current, endpoints: { ...current.endpoints, ollama: "http://127.0.0.1:11500" } }, result: null })),
    updateLocalModelSettings((current) => ({ settings: { ...current, endpoints: { ...current.endpoints, lmstudio: "http://127.0.0.1:1300" } }, result: null })),
  ]);
  assert.deepEqual(await readLocalModelSettings(), {
    endpoints: { ollama: "http://127.0.0.1:11500", lmstudio: "http://127.0.0.1:1300" }, allowRemote: false,
  });
  const unchanged = await updateLocalModelSettings(() => ({ settings: null, result: "refused" }));
  assert.equal(unchanged, "refused", "a refused change writes nothing");
});
