import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_CODEX_BACKENDS } from "../local-codex.ts";
import type { preflightLocalCodex } from "./local-codex-backends.ts";
import { launchModelArg, prepareLocalCodexLaunch, withLaunchModel } from "./local-codex-launch.ts";

type Preflight = typeof preflightLocalCodex;
const ollama = LOCAL_CODEX_BACKENDS["codex-ollama"];

function ready(endpoint: string, isDefault: boolean): { preflight: Preflight; asked: Array<string | null | undefined>; manifests: string[] } {
  const asked: Array<string | null | undefined> = [];
  const manifests: string[] = [];
  const preflight: Preflight = async (_harness, modelId) => {
    asked.push(modelId);
    return {
      ok: true, info: ollama, endpoint, isDefault, source: isDefault ? "default" : "settings", version: "0.40.6",
      nativeModel: String(modelId).slice("ollama/".length), configArgs: [],
    };
  };
  return { preflight, asked, manifests };
}

test("other runtimes are left alone and never probe a local server", async () => {
  let probed = false;
  const preflight: Preflight = async () => { probed = true; return null; };
  for (const harness of ["codex", "claude", "copilot", null, undefined]) {
    assert.deepEqual(await prepareLocalCodexLaunch(harness, "openai/gpt-5", "daemon", { preflight }), { local: false });
  }
  assert.equal(probed, false);
});

test("a saved id and a stripped launch id name the same model", async () => {
  const { preflight, asked } = ready("http://127.0.0.1:11434", true);
  const manifests: string[] = [];
  const ensureManifest = async (harness: string) => { manifests.push(harness); };
  const fromSaved = await prepareLocalCodexLaunch("codex-ollama", "ollama/qwen3:8b", "daemon", { preflight, ensureManifest });
  const fromLaunch = await prepareLocalCodexLaunch("codex-ollama", "qwen3:8b", "coven", { preflight, ensureManifest });
  assert.deepEqual(asked, ["ollama/qwen3:8b", "ollama/qwen3:8b"]);
  assert.ok(fromSaved.local && fromSaved.ok && fromSaved.nativeModel === "qwen3:8b");
  assert.ok(fromLaunch.local && fromLaunch.ok && fromLaunch.nativeModel === "qwen3:8b");
  assert.deepEqual(manifests, ["codex-ollama", "codex-ollama"], "the adapter manifest is ensured before any launch");
});

test("no model is a refusal, never a launch on Codex's own default", async () => {
  for (const model of [null, "", "  "]) {
    const launch = await prepareLocalCodexLaunch("codex-ollama", model, "coven", { ensureManifest: async () => {} });
    assert.equal(launch.local, true);
    assert.ok(launch.local && !launch.ok);
    assert.equal(launch.local && !launch.ok && launch.code, "local_model_unselected");
  }
});

test("a preflight refusal is passed on with its code and next step", async () => {
  const preflight: Preflight = async () => ({ ok: false, code: "local_server_unreachable", message: "Ollama isn't reachable at http://127.0.0.1:11434." });
  let ensured = false;
  const launch = await prepareLocalCodexLaunch("codex-ollama", "ollama/qwen3:8b", "daemon", { preflight, ensureManifest: async () => { ensured = true; } });
  assert.deepEqual(launch, { local: true, ok: false, code: "local_server_unreachable", message: "Ollama isn't reachable at http://127.0.0.1:11434." });
  assert.equal(ensured, false);
});

test("the daemon can't reach a saved custom address, so it is refused there and applied on coven run", async () => {
  const { preflight } = ready("http://127.0.0.1:11555", false);
  const daemon = await prepareLocalCodexLaunch("codex-ollama", "ollama/qwen3:8b", "daemon", { preflight, ensureManifest: async () => {} });
  assert.deepEqual(daemon, {
    local: true, ok: false, code: "local_endpoint_daemon",
    message: "Codex · Ollama is set to http://127.0.0.1:11555. This runs through the Coven daemon, which reaches only Ollama's default address (http://127.0.0.1:11434). Run it from chat, or clear the address in Settings → Local models.",
  });
  const coven = await prepareLocalCodexLaunch("codex-ollama", "ollama/qwen3:8b", "coven", { preflight, ensureManifest: async () => {} });
  assert.ok(coven.local && coven.ok);
  const env: Record<string, string | undefined> = { CODEX_OSS_BASE_URL: "http://inherited:1/v1", CODEX_OSS_PORT: "9", PATH: "/bin" };
  coven.applyEnv(env);
  assert.deepEqual(env, { CODEX_OSS_BASE_URL: "http://127.0.0.1:11555/v1", PATH: "/bin" });
});

test("on the default address an inherited server override is cleared", async () => {
  const { preflight } = ready("http://127.0.0.1:11434", true);
  const launch = await prepareLocalCodexLaunch("codex-ollama", "ollama/qwen3:8b", "coven", { preflight, ensureManifest: async () => {} });
  assert.ok(launch.local && launch.ok);
  const env: Record<string, string | undefined> = { CODEX_OSS_BASE_URL: "http://inherited:1/v1", PATH: "/bin" };
  launch.applyEnv(env);
  assert.deepEqual(env, { PATH: "/bin" });
});

test("--model is set before the prompt separator, replacing any earlier one", () => {
  assert.deepEqual(
    withLaunchModel(["run", "codex-ollama", "--stream-json", "--", "--model is in the prompt"], "qwen3:8b"),
    ["run", "codex-ollama", "--stream-json", "--model", "qwen3:8b", "--", "--model is in the prompt"],
  );
  assert.deepEqual(
    withLaunchModel(["run", "codex-ollama", "--model", "gpt-5", "--archive", "--", "p"], "qwen3:8b"),
    ["run", "codex-ollama", "--archive", "--model", "qwen3:8b", "--", "p"],
  );
  assert.equal(launchModelArg(["run", "x", "--model", "qwen3:8b", "--", "p"]), "qwen3:8b");
  assert.equal(launchModelArg(["run", "x", "--", "--model", "p"]), null, "a prompt that says --model is not a flag");
});
