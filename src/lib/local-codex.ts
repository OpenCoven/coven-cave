// Codex local mode: the Codex harness pointed at a local inference server
// (#6049).
//
// Ollama and LM Studio serve the model; Codex runs the agent loop, tools and
// sandbox exactly as it does for the cloud harness; Cave runs Codex through
// its direct `codex exec --json` transport. The two harness ids below differ
// from `codex` only in where inference happens. Every launch passes
// `model_provider`, so a local session can never reach a cloud model, and
// disables Codex's web-search tool: local inference must not imply web
// access, and Ollama's Responses API drops function-call names when a
// web_search tool is present in the request.
//
// Client-safe: no node imports.

export type LocalCodexBackend = "ollama" | "lmstudio";

export const LOCAL_CODEX_HARNESS_IDS = ["codex-ollama", "codex-lmstudio"] as const;
export type LocalCodexHarnessId = typeof LOCAL_CODEX_HARNESS_IDS[number];

export type LocalCodexBackendInfo = {
  backend: LocalCodexBackend;
  harness: LocalCodexHarnessId;
  /** The inference server's product name, for copy. */
  product: string;
  /** The harness label shown in runtime pickers. */
  label: string;
  /** Codex's built-in provider id for this server. */
  codexProvider: LocalCodexBackend;
  /** Where the server listens by default. */
  defaultEndpoint: string;
  /** Environment variable that overrides the endpoint. */
  endpointEnv: string;
  /** How to start the server, shown when it is unreachable. */
  startHint: string;
  /** How to add a model, shown when none is usable. */
  addModelHint: string;
};

export const LOCAL_CODEX_BACKENDS: Record<LocalCodexHarnessId, LocalCodexBackendInfo> = {
  "codex-ollama": {
    backend: "ollama",
    harness: "codex-ollama",
    product: "Ollama",
    label: "Codex · Ollama",
    codexProvider: "ollama",
    defaultEndpoint: "http://127.0.0.1:11434",
    endpointEnv: "CAVE_OLLAMA_URL",
    startHint: "Start Ollama (open the app, or run `ollama serve`).",
    addModelHint: "Pull a model with tool support, for example `ollama pull qwen3:8b`.",
  },
  "codex-lmstudio": {
    backend: "lmstudio",
    harness: "codex-lmstudio",
    product: "LM Studio",
    label: "Codex · LM Studio",
    codexProvider: "lmstudio",
    defaultEndpoint: "http://127.0.0.1:1234",
    endpointEnv: "CAVE_LMSTUDIO_URL",
    startHint: "Start LM Studio's server (Developer tab, or run `lms server start`).",
    addModelHint: "Download a model with tool support in LM Studio, for example Qwen3 8B.",
  },
};

/** The local backend a harness id runs on, or null for every other harness. */
export function localCodexBackendInfo(harness: string | null | undefined): LocalCodexBackendInfo | null {
  return harness && Object.hasOwn(LOCAL_CODEX_BACKENDS, harness)
    ? LOCAL_CODEX_BACKENDS[harness as LocalCodexHarnessId]
    : null;
}

export function isLocalCodexHarness(harness: string | null | undefined): harness is LocalCodexHarnessId {
  return localCodexBackendInfo(harness) !== null;
}

/** Codex and its local modes share the direct transport, resume and output parsing. */
export function isCodexFamilyHarness(harness: string | null | undefined): boolean {
  return harness === "codex" || isLocalCodexHarness(harness);
}

/** A non-default endpoint is passed to Codex as its own provider rather than
 * by editing a built-in one. */
const CUSTOM_PROVIDER_ID = "cave_local";

/**
 * Codex `-c` overrides for a local session. They are accepted by both
 * `codex exec` and `codex exec resume` (unlike `--oss`), so a resumed turn
 * stays on the same local provider. `endpoint` is the server's base URL when
 * it differs from the backend default; it must already be validated.
 */
export function localCodexConfigArgs(info: LocalCodexBackendInfo, endpoint: string | null): string[] {
  const args = ["-c", 'web_search="disabled"'];
  if (endpoint === null || endpoint === info.defaultEndpoint) {
    args.push("-c", `model_provider="${info.codexProvider}"`);
    return args;
  }
  args.push(
    "-c", `model_providers.${CUSTOM_PROVIDER_ID}.name="${info.product} (Cave)"`,
    "-c", `model_providers.${CUSTOM_PROVIDER_ID}.base_url="${endpoint}/v1"`,
    "-c", `model_providers.${CUSTOM_PROVIDER_ID}.wire_api="responses"`,
    "-c", `model_provider="${CUSTOM_PROVIDER_ID}"`,
  );
  return args;
}

/** Cave's namespaced model id for a backend-native model name: `ollama/qwen3:8b`. */
export function localCodexModelId(info: LocalCodexBackendInfo, nativeModel: string): string {
  return `${info.backend}/${nativeModel}`;
}

/** The backend-native model name from Cave's namespaced id, or null when it names another provider. */
export function localCodexNativeModel(info: LocalCodexBackendInfo, modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const prefix = `${info.backend}/`;
  if (!modelId.startsWith(prefix)) return null;
  const native = modelId.slice(prefix.length);
  return native.length > 0 ? native : null;
}

/**
 * The Coven adapter manifest Cave scaffolds for a local harness, used when a
 * chat runs through `coven run` rather than Cave's direct Codex transport
 * (any Codex version Cave has no verified event schema for). It mirrors the
 * built-in Codex harness argv (`exec --skip-git-repo-check --color never`)
 * plus the local overrides. Coven's manifest guard refuses `-c` in prompt
 * prefix args, so the long `--config` form is used. The manifest targets the
 * backend's default endpoint; a custom endpoint needs the direct transport.
 */
export function localCodexAdapterManifest(info: LocalCodexBackendInfo): { adapters: Array<Record<string, unknown>> } {
  const local = ["--config", 'web_search="disabled"', "--config", `model_provider="${info.codexProvider}"`];
  const exec = ["exec", "--skip-git-repo-check", "--color", "never", ...local];
  return {
    adapters: [{
      id: info.harness,
      label: info.label,
      executable: "codex",
      interactive_prompt_prefix_args: local,
      non_interactive_prompt_prefix_args: exec,
      install_hint: `Install Codex (npm install -g @openai/codex) and ${info.product}. ${info.startHint} ${info.addModelHint}`,
      model_flag: "--model",
      sandbox: { flag: "--sandbox", full: "danger-full-access", read_only: "read-only" },
      add_dir_flag: "--add-dir",
      capabilities: { stream: false, preassigned_session_id: false, think: false, speed: false },
      continuity_args: { init_prefix_args: [], resume_prefix_args: [...exec, "resume"] },
      version: "1.0.0",
      description: `Codex local mode: the Codex agent loop with inference on ${info.product} at ${info.defaultEndpoint}. Web search is disabled and no cloud model is reachable.`,
    }],
  };
}
