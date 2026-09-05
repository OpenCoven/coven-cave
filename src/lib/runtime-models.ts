// Runtime → provider → models map. Pure, dependency-free data + helpers.
//
// "Model parity" means every runtime gets the same first-class, working model
// selection, sourced from the provider tied to that runtime where one exists.
// Model ids follow Cave's existing namespaced convention (`provider/model`),
// matching the live default (`openai/gpt-5.6-sol`).
//
// Curated fallback lists are generated from config/runtime-model-catalog.json.
// `allowCustom` is the safety valve so the menu never blocks an id that is not
// listed yet. Runtime-managed adapters get `provider: null` and render a
// free-text field only. Live account-scoped discovery can replace these seeds.

export type RuntimeProvider = "openai" | "anthropic" | "github" | "nous" | "xai" | null;

import {
  CLAUDE_OPUS_5_CAVE_ID,
  CLAUDE_OPUS_5_NATIVE_MODEL,
} from "./claude-models.ts";
import { GENERATED_RUNTIME_MODEL_CATALOG } from "./runtime-model-catalog.gen.ts";
import { REGISTRY_RUNTIMES } from "./runtime-registry.gen.ts";
import { canonicalHarnessId } from "./harness-adapters.ts";

export type RuntimeModelOption = { id: string; label: string };

export type RuntimeModelInventoryProvenance =
  | "live"
  | "cached"
  | "fallback"
  | "runtime-managed"
  | "unavailable";

export type RuntimeModelInventoryFreshness =
  | "fresh"
  | "cached"
  | "seed"
  | "runtime-managed"
  | "unavailable";

export type RuntimeModelInventoryRefreshState = "ready" | "degraded";
export type RuntimeModelInventoryAvailability = "available" | "degraded" | "unavailable";

/** Non-secret identity for the inventory request. Credential values and
 * provider URLs deliberately never cross this boundary. */
export type RuntimeModelInventoryScope = {
  familiarId: string | null;
  runtime: string;
  provider: RuntimeProvider;
  credentialScope: "familiar" | "global" | "runtime-managed" | "unavailable";
  providerConfiguration: "familiar" | "global" | "runtime-managed" | "unavailable";
};

export type RuntimeModelInventory = {
  runtime: string;
  models: RuntimeModelOption[];
  provenance: RuntimeModelInventoryProvenance;
  freshness: RuntimeModelInventoryFreshness;
  refreshState: RuntimeModelInventoryRefreshState;
  availability: RuntimeModelInventoryAvailability;
  defaultOwner: "cave" | "runtime";
  allowCustom: boolean;
  scope: RuntimeModelInventoryScope;
};

type RuntimeModelTransformMetadata = {
  id: string;
  modelIdTransform?: unknown;
};

const MODEL_PROVIDER_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;
const MODEL_PATH_SEGMENT_RE = /^~?[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;

export function isSafeRuntimeModelId(value: string): boolean {
  if (!value || value.includes("..")) return false;
  const [provider, ...modelPath] = value.split("/");
  if (!MODEL_PROVIDER_RE.test(provider ?? "")) return false;
  return modelPath.every((segment) => MODEL_PATH_SEGMENT_RE.test(segment));
}

/**
 * Apply the adapter registry's model-id transform using the same semantics as
 * Coven's Rust authority layer. Unknown or missing metadata defaults to
 * stripping one non-empty provider segment for compatibility with older
 * registries.
 */
export function transformModelIdForRuntime(
  runtimeId: string,
  modelId: string,
  runtimes: readonly RuntimeModelTransformMetadata[] = REGISTRY_RUNTIMES,
): string {
  const canonicalRuntime = canonicalHarnessId(runtimeId);
  const transform = runtimes.find((runtime) => runtime.id === canonicalRuntime)?.modelIdTransform;
  if (transform === "preserve") return modelId;

  const slash = modelId.indexOf("/");
  const remainder = slash > 0 ? modelId.slice(slash + 1) : "";
  return remainder && !remainder.startsWith("/") ? remainder : modelId;
}

/**
 * Return a model id safe to place in a direct runtime launch. Validation runs
 * after transformation because stripping can expose a flag-shaped value.
 */
export function runtimeModelIdForLaunch(runtimeId: string, modelId: string | null): string | null {
  if (!modelId) return null;
  const transformed = transformModelIdForRuntime(runtimeId, modelId);
  return isSafeRuntimeModelId(transformed) ? transformed : null;
}

export type RuntimeModelCatalog = {
  /** Harness id: codex | claude | copilot | hermes | openclaw. */
  runtime: string;
  provider: RuntimeProvider;
  /** Curated seed; empty ⇒ no menu, free-text only. */
  models: RuntimeModelOption[];
  /** Fallback when no curated model exists. Runtime markers are synthetic. */
  defaultModel?: string;
  /** User may type any model id not present in `models`. */
  allowCustom: boolean;
  /**
   * Who chooses the model when Cave has no explicit familiar/session/turn
   * selection. A runtime-owned default is represented by omitting the model
   * launch argument; catalog entries remain choices, never implicit defaults.
   */
  defaultOwner: "cave" | "runtime";
};

export const RUNTIME_MODEL_CATALOG: Record<string, RuntimeModelCatalog> =
  GENERATED_RUNTIME_MODEL_CATALOG;

const GLOBAL_DEFAULT_MODEL = "openai/gpt-5.6-sol";

const DYNAMIC_INVENTORY_RUNTIMES = new Set([
  "claude",
  "copilot",
  "grok",
  "hermes",
  "opencode",
]);
const INVENTORY_FAMILIAR_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function runtimeModelInventoryScope(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelInventoryScope {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const candidateFamiliarId = typeof familiarId === "string" ? familiarId.trim() : "";
  const normalizedFamiliarId = INVENTORY_FAMILIAR_ID.test(candidateFamiliarId)
    ? candidateFamiliarId
    : null;
  const catalog = catalogForRuntime(canonicalRuntime);
  const knownRuntime = catalog !== null;
  const credentialScope = !knownRuntime
    ? "unavailable"
    : DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime)
      ? normalizedFamiliarId ? "familiar" : "global"
      : catalog?.provider
        ? "global"
        : "runtime-managed";
  const providerConfiguration = !knownRuntime
    ? "unavailable"
    : DYNAMIC_INVENTORY_RUNTIMES.has(canonicalRuntime)
      ? normalizedFamiliarId ? "familiar" : "global"
      : catalog?.provider
        ? "global"
        : "runtime-managed";
  return {
    familiarId: normalizedFamiliarId,
    runtime: canonicalRuntime,
    provider: catalog?.provider ?? null,
    credentialScope,
    providerConfiguration,
  };
}

export function runtimeModelInventoryFreshness(
  provenance: RuntimeModelInventoryProvenance,
): RuntimeModelInventoryFreshness {
  switch (provenance) {
    case "live": return "fresh";
    case "cached": return "cached";
    case "fallback": return "seed";
    case "runtime-managed": return "runtime-managed";
    case "unavailable": return "unavailable";
  }
}

export function runtimeModelInventoryAvailability(
  provenance: RuntimeModelInventoryProvenance,
): RuntimeModelInventoryAvailability {
  switch (provenance) {
    case "live":
    case "cached":
      return "available";
    case "fallback":
    case "runtime-managed":
      return "degraded";
    case "unavailable":
      return "unavailable";
  }
}

export function runtimeModelInventoryRefreshState(
  provenance: RuntimeModelInventoryProvenance,
): RuntimeModelInventoryRefreshState {
  return provenance === "live" || provenance === "cached" ? "ready" : "degraded";
}

export function catalogForRuntime(runtime: string): RuntimeModelCatalog | null {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const curated = RUNTIME_MODEL_CATALOG[canonicalRuntime];
  if (curated) return curated;
  // Registry-synced runtimes without a curated list get the runtime-managed
  // treatment: no menu, free-text only (same branch as openclaw above).
  if (REGISTRY_RUNTIMES.some((entry) => entry.id === canonicalRuntime)) {
    return {
      runtime: canonicalRuntime,
      provider: null,
      models: [],
      allowCustom: true,
      defaultOwner: "runtime",
    };
  }
  return null;
}

export function defaultModelForRuntime(runtime: string): string {
  const catalog = catalogForRuntime(runtime);
  return catalog?.models[0]?.id ?? catalog?.defaultModel ?? GLOBAL_DEFAULT_MODEL;
}

/** Whether an unselected launch must defer to the runtime/provider config. */
export function runtimeOwnsModelDefault(runtime: string): boolean {
  const canonical = canonicalHarnessId(runtime);
  return catalogForRuntime(canonical)?.defaultOwner === "runtime";
}

/** Enforce the selected runtime's custom-id policy at every write/launch
 * boundary, not only in picker rendering. Known catalogs that allow custom
 * ids accept safe ids; runtimes without a catalog fail closed. */
export function isModelAllowedByRuntime(runtime: string, modelId: string): boolean {
  const catalog = catalogForRuntime(runtime);
  if (!catalog || !modelId) return false;
  return catalog.allowCustom || catalog.models.some((model) => model.id === modelId);
}

/**
 * Resolve the model value persisted during a runtime switch. Explicit user
 * selections win; otherwise the explicit empty value records runtime-default
 * intent so config merge paths do not reconstruct a stale previous model.
 */
export function modelForRuntimeSwitch(
  _runtime: string,
  selectedModel?: string | null,
): string {
  const explicitModel = selectedModel?.trim() ?? "";
  if (explicitModel) return explicitModel;
  // A runtime switch without a user model pick is a default-intent change.
  // Catalog entries are conservative seeds, never an implicit launch override.
  return "";
}

export function isModelInCatalog(runtime: string, modelId: string): boolean {
  const catalog = catalogForRuntime(runtime);
  if (!catalog) return false;
  return catalog.models.some((model) => model.id === modelId);
}

/** Translate a stable Cave model id only at the native runtime boundary. */
export function modelForRuntimeLaunch(runtime: string, modelId: string): string {
  const canonicalRuntime = canonicalHarnessId(runtime);
  if (canonicalRuntime === "claude" && modelId === CLAUDE_OPUS_5_CAVE_ID) {
    return CLAUDE_OPUS_5_NATIVE_MODEL;
  }
  return modelId;
}

function bareModelId(modelId: string): string {
  return modelId.includes("/")
    ? modelId.slice(modelId.indexOf("/") + 1)
    : modelId;
}

/**
 * Convert a transport/native echo back to the stable id Cave selected.
 * Runtimes may echo either the namespaced transport value or the bare value
 * they received after Coven/native argv normalization. An unexpected resolved
 * model remains authoritative.
 */
export function modelForCaveFromRuntimeEcho(
  runtime: string,
  requestedModelId: string,
  echoedModelId: string,
): string {
  const transportModelId = modelForRuntimeLaunch(runtime, requestedModelId);
  const expectedEchoes = new Set([
    requestedModelId,
    bareModelId(requestedModelId),
    transportModelId,
    bareModelId(transportModelId),
  ]);
  return expectedEchoes.has(echoedModelId)
    ? requestedModelId
    : echoedModelId;
}
