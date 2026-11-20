import assert from "node:assert/strict";
import test from "node:test";
import {
  lmStudioModelLocation,
  parseLmsLinkStatus,
  parseLmsModelList,
  readLmStudioDevices,
  type LmsRunner,
} from "./lmstudio-devices.ts";

// Shapes recorded from LM Studio 0.4.21 (`lms ls --json`, `lms link status
// --json`) with LM Link online; device ids and names are anonymized.
const PEER = "7c1972de0a025c8b753be245afd32df2";
const THIS = "5acdfe12b91ff9ecbf75fe9da278b652";
const lsJson = JSON.stringify([
  { type: "llm", modelKey: "qwen3-8b", format: "gguf", publisher: "ollama-library", path: "ollama-library/qwen3-8b/Qwen3-8B-Q4_K_M.gguf", deviceIdentifier: null, trainedForToolUse: true, maxContextLength: 40960 },
  { type: "embedding", modelKey: "text-embedding-nomic-embed-text-v1.5", path: "nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.Q4_K_M.gguf", deviceIdentifier: null },
  { type: "llm", modelKey: "qwen/qwen3.8-27b", format: "safetensors", publisher: "qwen", path: `${PEER}:qwen/qwen3.8-27b`, deviceIdentifier: PEER, trainedForToolUse: true, maxContextLength: 262144 },
]);
const linkJson = JSON.stringify({
  status: "online", issues: [], deviceIdentifier: THIS, deviceName: "this-mac.local",
  peers: [{ deviceIdentifier: PEER, deviceName: "studio-mac.local", status: "online", loadedModels: [] }],
});

function runner(answers: Record<string, string | null>): LmsRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return answers[args.join(" ")] ?? null;
  };
  return Object.assign(run, { calls });
}

test("lms ls marks each model's device: null is this computer", () => {
  assert.deepEqual(parseLmsModelList(lsJson), [
    { key: "qwen3-8b", device: null },
    { key: "text-embedding-nomic-embed-text-v1.5", device: null },
    { key: "qwen/qwen3.8-27b", device: PEER },
  ]);
  assert.equal(parseLmsModelList("not json"), null);
  assert.equal(parseLmsModelList(JSON.stringify({ models: [] })), null, "anything but the list is unreadable");
  assert.deepEqual(parseLmsModelList(JSON.stringify([{ modelKey: "odd", deviceIdentifier: "../../etc" }])), [{ key: "odd", device: "unknown" }],
    "an unreadable device id never proves a model is local");
});

test("lms link status names the peers", () => {
  assert.deepEqual(parseLmsLinkStatus(linkJson), { thisDevice: THIS, deviceNames: { [PEER]: "studio-mac.local" } });
  assert.deepEqual(parseLmsLinkStatus(JSON.stringify({ status: "disabled" })), { thisDevice: null, deviceNames: {} });
  assert.equal(parseLmsLinkStatus("[]"), null);
});

test("a model is on this computer only when lms lists it here and nowhere else", async () => {
  const lms = runner({ "ls --json": lsJson, "link status --json": linkJson });
  const listing = await readLmStudioDevices(lms);
  assert.deepEqual(lms.calls, [["ls", "--json"], ["link", "status", "--json"]]);
  assert.deepEqual(lmStudioModelLocation("qwen3-8b", listing), { kind: "this-computer" });
  assert.deepEqual(lmStudioModelLocation("qwen/qwen3.8-27b", listing), { kind: "lm-link", deviceName: "studio-mac.local" });
  assert.deepEqual(lmStudioModelLocation("not-listed-by-lms", listing), { kind: "lm-link", deviceName: null },
    "a model the server lists but lms doesn't list here may run elsewhere");

  const both = await readLmStudioDevices(runner({
    "ls --json": JSON.stringify([{ modelKey: "qwen3-8b", deviceIdentifier: null }, { modelKey: "qwen3-8b", deviceIdentifier: PEER }]),
    "link status --json": linkJson,
  }));
  assert.deepEqual(lmStudioModelLocation("qwen3-8b", both), { kind: "lm-link", deviceName: "studio-mac.local" },
    "on several devices LM Studio routes to the preferred one, which may be the peer");

  const selfReported = await readLmStudioDevices(runner({
    "ls --json": JSON.stringify([{ modelKey: "qwen3-8b", deviceIdentifier: THIS }]),
    "link status --json": linkJson,
  }));
  assert.deepEqual(lmStudioModelLocation("qwen3-8b", selfReported), { kind: "this-computer" }, "this computer's own id is local");
});

test("without lms Cave says it couldn't check; peer names are optional", async () => {
  const missing = await readLmStudioDevices(runner({}));
  assert.deepEqual(missing, { ok: false });
  assert.deepEqual(lmStudioModelLocation("qwen3-8b", missing), { kind: "unchecked" });

  const unnamed = await readLmStudioDevices(runner({ "ls --json": lsJson }));
  assert.equal(unnamed.ok, true);
  assert.deepEqual(lmStudioModelLocation("qwen/qwen3.8-27b", unnamed), { kind: "lm-link", deviceName: null });
});
