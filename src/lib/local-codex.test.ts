import assert from "node:assert/strict";
import test from "node:test";
import { adapterManifestScaffoldForHarness, canonicalHarnessId, isTrustedChatHarness } from "./harness-adapters.ts";
import {
  LOCAL_CODEX_BACKENDS,
  LOCAL_CODEX_REFUSAL_CODES,
  isCodexFamilyHarness,
  isLocalCodexHarness,
  isLocalCodexRefusalCode,
  localCodexAdapterManifest,
  localCodexBackendInfo,
  localCodexConfigArgs,
  localCodexModelId,
  localCodexNativeModel,
} from "./local-codex.ts";
import { isModelAllowedByRuntime, runtimeModelIdForLaunch } from "./runtime-models.ts";

const ollama = LOCAL_CODEX_BACKENDS["codex-ollama"];
const lmstudio = LOCAL_CODEX_BACKENDS["codex-lmstudio"];

test("the local harnesses are Codex for transport and resume, and nothing else is", () => {
  assert.equal(isLocalCodexHarness("codex-ollama"), true);
  assert.equal(isLocalCodexHarness("codex"), false);
  assert.equal(isCodexFamilyHarness("codex"), true);
  assert.equal(isCodexFamilyHarness("codex-lmstudio"), true);
  assert.equal(isCodexFamilyHarness("claude"), false);
  assert.equal(localCodexBackendInfo("toString"), null, "prototype keys are not backends");
  assert.equal(canonicalHarnessId("codex-ollama"), "codex-ollama", "the shared `codex` binary does not collapse the id");
  assert.ok(isTrustedChatHarness("codex-lmstudio"));
});

test("only a listed local refusal counts as fully explained by its message (#6095)", () => {
  for (const code of LOCAL_CODEX_REFUSAL_CODES) assert.equal(isLocalCodexRefusalCode(code), true, code);
  assert.ok(LOCAL_CODEX_REFUSAL_CODES.includes("local_server_unreachable"));
  for (const code of ["chat_run_active", "project_access_denied", "harness_usage_limit", "local_server", "LOCAL_SERVER_UNREACHABLE", "toString", "", null, undefined, 409, ["local_server_unreachable"]]) {
    assert.equal(isLocalCodexRefusalCode(code), false, String(code));
  }
});

test("model ids are namespaced by backend and launch as the server's own name", () => {
  assert.equal(localCodexModelId(ollama, "qwen3:8b"), "ollama/qwen3:8b");
  assert.equal(localCodexNativeModel(ollama, "ollama/qwen3:8b"), "qwen3:8b");
  assert.equal(localCodexNativeModel(lmstudio, "lmstudio/qwen/qwen3.8-27b"), "qwen/qwen3.8-27b");
  assert.equal(localCodexNativeModel(ollama, "openai/gpt-5.5"), null, "a cloud id is not a local model");
  assert.equal(localCodexNativeModel(ollama, "ollama/"), null);
  assert.equal(runtimeModelIdForLaunch("codex", "ollama/qwen3:8b"), "qwen3:8b");
  assert.equal(runtimeModelIdForLaunch("codex", "lmstudio/qwen/qwen3.8-27b"), "qwen/qwen3.8-27b");
  assert.equal(isModelAllowedByRuntime("codex-ollama", "ollama/qwen3:8b"), true);
  assert.equal(isModelAllowedByRuntime("codex-ollama", "openai/gpt-5.5"), false, "a cloud model is refused for a local harness");
  assert.equal(isModelAllowedByRuntime("codex-lmstudio", "ollama/qwen3:8b"), false, "one server's model is not another's");
});

test("every launch names the local provider and disables web search", () => {
  assert.deepEqual(localCodexConfigArgs(ollama, null), ["-c", 'web_search="disabled"', "-c", 'model_provider="ollama"']);
  assert.deepEqual(localCodexConfigArgs(lmstudio, "http://127.0.0.1:1234"), ["-c", 'web_search="disabled"', "-c", 'model_provider="lmstudio"']);
});

test("Cave scaffolds a Coven manifest that mirrors Codex with the local overrides in --config form", () => {
  const manifest = localCodexAdapterManifest(lmstudio);
  const [adapter] = manifest.adapters;
  assert.equal(adapter.id, "codex-lmstudio");
  assert.equal(adapter.executable, "codex");
  const local = ["--config", 'web_search="disabled"', "--config", 'model_provider="lmstudio"'];
  assert.deepEqual(adapter.non_interactive_prompt_prefix_args, ["exec", "--skip-git-repo-check", "--color", "never", ...local]);
  assert.deepEqual(adapter.interactive_prompt_prefix_args, local);
  assert.ok(!JSON.stringify(manifest).includes('"-c"'), "Coven refuses -c in prompt prefix args");
  assert.deepEqual(adapter.continuity_args, { init_prefix_args: [], resume_prefix_args: ["exec", "--skip-git-repo-check", "--color", "never", ...local, "resume"] });
  assert.deepEqual(adapter.sandbox, { flag: "--sandbox", full: "danger-full-access", read_only: "read-only" });
  const scaffold = adapterManifestScaffoldForHarness("codex-lmstudio");
  assert.equal(scaffold?.filename, "codex-lmstudio.json");
  assert.deepEqual(JSON.parse(scaffold?.contents ?? "{}"), manifest);
  assert.equal(adapterManifestScaffoldForHarness("codex"), null, "cloud Codex is built into Coven");
});
