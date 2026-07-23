// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cardTypes = readFileSync(new URL("../lib/cave-board-types.ts", import.meta.url), "utf8");
const boardStore = readFileSync(new URL("../lib/cave-board.ts", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./board-inspector.tsx", import.meta.url), "utf8");
const boardView = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");
const createRoute = readFileSync(new URL("../app/api/board/route.ts", import.meta.url), "utf8");
const patchRoute = readFileSync(new URL("../app/api/board/[id]/route.ts", import.meta.url), "utf8");
const taskRoute = readFileSync(new URL("../app/api/board/[id]/chat/route.ts", import.meta.url), "utf8");

assert.match(cardTypes, /modelOverride\?: string \| null/, "cards persist an optional task model override");
assert.match(cardTypes, /modelOverrideHarness\?: string \| null/, "cards persist the runtime that supplied a task model override");
assert.match(boardStore, /function normalizeModelOverride/, "board storage bounds persisted task model ids");
assert.match(boardStore, /function normalizeModelOverrideHarness/, "board storage canonicalizes persisted model runtime ids");
assert.match(boardStore, /modelOverride: normalizeModelOverride\(input\.modelOverride\)/, "card creation persists a normalized task model");
assert.match(boardStore, /modelOverrideHarness: normalizeModelOverrideHarness\(input\.modelOverrideHarness\)/, "card creation persists the model runtime");
assert.match(boardStore, /modelOverride: "modelOverride" in patch[\s\S]{0,140}normalizeModelOverride\(patch\.modelOverride\)/, "card patches persist a normalized task model");
assert.match(createRoute, /modelOverride\?: string \| null/, "board create API accepts a task model override");
assert.match(createRoute, /modelOverrideHarness\?: string \| null/, "board create API accepts the model runtime");
assert.match(patchRoute, /modelOverride: string \| null/, "board patch API accepts a task model override");
assert.match(patchRoute, /modelOverrideHarness: string \| null/, "board patch API accepts the model runtime");
assert.match(inspector, /useRuntimeModelOptions\(modelHarness, currentFamiliar\?\.id \?\? null\)/, "inspector loads the selected familiar runtime's model options");
assert.match(
  inspector,
  /runtimeModelOptions\.map\(\(option\) => \(\{ value: option\.id, label: option\.label \}\)\)/,
  "the inspector renders every runtime-provided model option, including authenticated catalogs",
);
assert.match(inspector, /const taskModelPatch = \(modelOverride: string \| null\): CardPatch => \(\{[\s\S]{0,120}modelOverrideHarness: modelOverride \? modelHarness \|\| null : null/, "the inspector tags each task model with its selected runtime");
assert.match(inspector, /persistTaskModelPatch\(\{[\s\S]{0,120}familiarId: next \|\| null,[\s\S]{0,120}sessionId: null,[\s\S]{0,120}\.\.\.taskModelPatch\(null\)/, "changing familiar clears the linked session, prior task model, and runtime");
assert.match(inspector, /label="Model"/, "inspector exposes a Model control");
assert.match(
  inspector,
  /const hasUnsavedCustomModelDraft = customModelDraft !== \(card\.modelOverride \?\? ""\)/,
  "an in-progress custom model survives an asynchronously discovered catalog",
);
assert.match(
  inspector,
  /!taskModelIsCustom && !hasUnsavedCustomModelDraft/,
  "a late catalog response cannot replace an active custom model input",
);
assert.match(taskRoute, /card\.modelOverride && card\.modelOverrideHarness === binding\.harness/, "new task sessions only use an override from the familiar's current runtime");
assert.match(taskRoute, /updateCard\(card\.id, \{ modelOverride: null, modelOverrideHarness: null \}\)/, "a stale task model is cleared before launch");
assert.match(taskRoute, /model: taskModelOverride \?\? binding\.model/, "new task sessions otherwise use the familiar default model");
assert.match(inspector, /const pendingModelSaveRef = useRef<Promise<boolean> \| null>\(null\)/, "the inspector tracks a pending model save");
assert.match(inspector, /const previous = pendingModelSaveRef\.current \?\? Promise\.resolve\(true\)/, "model saves serialize back-to-back blur and familiar changes");
assert.match(inspector, /await \(pendingModelSaveRef\.current \?\? Promise\.resolve\(true\)\)/, "starting work waits for the pending model save");
assert.match(inspector, /onClick=\{\(\) => void openTaskWorkAfterModelSave\(\)\}/, "Start work uses the model-save-aware handler");
assert.match(
  boardView,
  /patchCard\(id, \{ modelOverride: null, modelOverrideHarness: null \}\)[\s\S]{0,400}await openTaskWork\(id\)/,
  "harness recovery clears the prior runtime's model before retrying the task",
);

console.log("board-task-model.test.ts: ok");
