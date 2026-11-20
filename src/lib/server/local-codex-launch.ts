// Codex local mode outside /api/chat/send (#6049).
//
// Chat checks a local session before anything spawns (`preflightLocalCodex`)
// and pins its server. Board, workflow, flow, rewrite and replay launches
// start the same harness through a one-shot `coven run` or a Coven daemon
// session, so they ask here first. A launch that can't run locally is
// refused with what to do; it never runs Codex without a model (Codex would
// pick a cloud default the local server doesn't have) and never falls back
// to a cloud model.

import { canonicalHarnessId } from "../harness-adapters.ts";
import { localCodexBackendInfo, localCodexModelId, type LocalCodexBackendInfo } from "../local-codex.ts";
import { ensureAdapterManifestScaffold } from "./adapter-manifest-scaffold.ts";
import { applyLocalCodexSpawnEnv, preflightLocalCodex, type LocalCodexPreflight } from "./local-codex-backends.ts";

/**
 * `coven`: Cave spawns `coven run` itself and controls its environment.
 * `daemon`: the Coven daemon spawns it, in the daemon's own environment.
 */
export type LocalCodexLaunchTransport = "coven" | "daemon";

export type LocalCodexLaunch =
  | { local: false }
  | {
    local: true;
    ok: true;
    info: LocalCodexBackendInfo;
    /** The model name Codex receives with `--model`. */
    nativeModel: string;
    /** Points a `coven run` child at this launch's server. */
    applyEnv: (env: Record<string, string | undefined>) => void;
  }
  | { local: true; ok: false; code: string; message: string };

type Dependencies = {
  preflight?: typeof preflightLocalCodex;
  ensureManifest?: (harness: string) => Promise<unknown>;
};

/**
 * The model a launch asked for, as Cave's namespaced id. Callers hold either
 * the saved id (`ollama/qwen3:8b`) or the launch form with the prefix
 * stripped (`qwen3:8b`); both name the same model.
 */
function namespacedModel(info: LocalCodexBackendInfo, model: string | null | undefined): string | null {
  const clean = typeof model === "string" ? model.trim() : "";
  if (!clean) return null;
  return clean.startsWith(`${info.backend}/`) ? clean : localCodexModelId(info, clean);
}

export async function prepareLocalCodexLaunch(
  harness: string | null | undefined,
  model: string | null | undefined,
  transport: LocalCodexLaunchTransport,
  dependencies: Dependencies = {},
): Promise<LocalCodexLaunch> {
  const info = harness ? localCodexBackendInfo(canonicalHarnessId(harness)) : null;
  if (!info) return { local: false };
  const preflight: LocalCodexPreflight | null = await (dependencies.preflight ?? preflightLocalCodex)(
    info.harness,
    namespacedModel(info, model),
  );
  if (!preflight) return { local: false };
  if (!preflight.ok) return { local: true, ok: false, code: preflight.code, message: preflight.message };
  if (transport === "daemon" && !preflight.isDefault) {
    // The daemon starts Codex in its own environment, so Cave can't hand it
    // the saved address; the scaffolded manifest targets the default one.
    return {
      local: true,
      ok: false,
      code: "local_endpoint_daemon",
      message: `${info.label} is set to ${preflight.endpoint}. This runs through the Coven daemon, which reaches only ${info.product}'s default address (${info.defaultEndpoint}). Run it from chat, or clear the address in Settings → Local models.`,
    };
  }
  // `coven run codex-ollama` needs Cave's adapter manifest. It is written
  // when a familiar is bound, but a launch must not depend on that order.
  await (dependencies.ensureManifest ?? ensureAdapterManifestScaffold)(info.harness).catch(() => false);
  return {
    local: true,
    ok: true,
    info,
    nativeModel: preflight.nativeModel,
    applyEnv: (env) => applyLocalCodexSpawnEnv(env, preflight, "coven"),
  };
}

/**
 * `coven run <harness> … -- prompt` argv with `--model` set to `model`,
 * replacing any model already given. Flags stay before the `--` separator.
 */
export function withLaunchModel(args: readonly string[], model: string): string[] {
  const out: string[] = [];
  let separator = args.length;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") {
      separator = index;
      break;
    }
    if (args[index] === "--model") {
      index += 1;
      continue;
    }
    out.push(args[index]);
  }
  return [...out, "--model", model, ...args.slice(separator)];
}

/** The value of `--model` before the `--` separator, if any. */
export function launchModelArg(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") return null;
    if (args[index] === "--model") return args[index + 1] ?? null;
  }
  return null;
}
