import { newestRuntimeModelFamilies } from "../runtime-model-families.ts";
import { canonicalHarnessId } from "../harness-adapters.ts";
import { cleanModelId, isSyntheticLocalModel } from "../chat-model-state.ts";
import {
  catalogForRuntime,
  runtimeModelInventoryAvailability,
  runtimeModelInventoryFreshness,
  runtimeModelInventoryRefreshState,
  runtimeModelInventoryScope,
  type RuntimeModelInventory,
  type RuntimeModelDiscoveryIssue,
  type RuntimeModelInventoryProvenance,
  type RuntimeModelOption,
} from "../runtime-models.ts";
import { listCliRuntimeModels } from "./cli-runtime-models.ts";
import { listCopilotModelInventory, listCopilotModels } from "./copilot-models.ts";
import { listGrokModels } from "./grok-models.ts";
import {
  listHermesModelInventory,
  listHermesModels,
} from "./hermes-models.ts";
import { listOpenCodeModels } from "./opencode-models.ts";
import { localCodexBackendInfo, localCodexModelId } from "../local-codex.ts";
import { localModelRunsHere, localModelsAllowRemote, probeLocalCodexBackend } from "./local-codex-backends.ts";
import { readLocalModelSettings } from "./local-models-settings.ts";

export type RuntimeModelOptionsDependencies = {
  allowOpenCodeInventory?: boolean;
  inventoryRestriction?: RuntimeModelDiscoveryIssue;
  /** Local discovery cannot describe an SSH/profile-bound runtime. */
  allowCliInventory?: boolean;
  listCodexInventory?: (familiarId?: string | null) => ReturnType<typeof listCliRuntimeModels>;
  /** Hermes API discovery is valid only for a bare, local binding. Callers
   * that resolved familiar profile/SSH state opt in explicitly. */
  allowHermesInventory?: boolean;
  listClaude?: (familiarId?: string | null) => Promise<RuntimeModelOption[]>;
  listCopilot?: typeof listCopilotModels;
  listClaudeInventory?: (familiarId?: string | null) => ReturnType<typeof listCliRuntimeModels>;
  listCopilotInventory?: typeof listCopilotModelInventory;
  listGrok?: typeof listGrokModels;
  listHermes?: typeof listHermesModels;
  listHermesInventory?: typeof listHermesModelInventory;
  listOpenCode?: typeof listOpenCodeModels;
  /** Codex local mode: ask the inference server what it can run. */
  probeLocalBackend?: typeof probeLocalCodexBackend;
  /** Codex local mode: whether prompts may go to another computer (Settings or environment). */
  localAllowRemote?: () => Promise<boolean>;
};

async function readLocalAllowRemote(): Promise<boolean> {
  return localModelsAllowRemote(process.env, await readLocalModelSettings()).value;
}

function sanitizeModels(
  runtime: string,
  options: readonly RuntimeModelOption[],
): RuntimeModelOption[] {
  const models = new Map<string, RuntimeModelOption>();
  for (const option of options) {
    const id = cleanModelId(option.id);
    if (!id || isSyntheticLocalModel(id, runtime)) continue;
    const label = typeof option.label === "string" && option.label.trim()
      ? option.label.trim()
      : id;
    const configuredModelId = cleanModelId(option.configuredModelId);
    models.set(id, { id, label, ...(configuredModelId && configuredModelId !== id ? { configuredModelId } : {}) });
  }
  // A local server lists exactly the models someone downloaded, so an older
  // release there is a deliberate choice, not a stale catalog entry.
  return localCodexBackendInfo(runtime)
    ? [...models.values()]
    : newestRuntimeModelFamilies([...models.values()]);
}

function withProvenance(
  inventory: RuntimeModelInventory,
  provenance: RuntimeModelInventoryProvenance,
  models: RuntimeModelOption[] = inventory.models,
): RuntimeModelInventory {
  const { discoveryIssue, ...base } = inventory;
  return {
    ...base,
    ...(models.length === 0 && discoveryIssue ? { discoveryIssue } : {}),
    models,
    provenance,
    freshness: runtimeModelInventoryFreshness(provenance),
    refreshState: runtimeModelInventoryRefreshState(provenance),
    availability: runtimeModelInventoryAvailability(provenance),
  };
}

function fallbackInventory(
  runtime: string,
  familiarId?: string | null,
): RuntimeModelInventory {
  const catalog = catalogForRuntime(runtime);
  // A catalog seed is historical metadata, not evidence of current support.
  const models: RuntimeModelOption[] = [];
  const provenance: RuntimeModelInventoryProvenance =
    catalog?.defaultOwner === "runtime" ? "runtime-managed" : "unavailable";
  return withProvenance({
    runtime,
    models,
    defaultOwner: catalog?.defaultOwner ?? "runtime",
    allowCustom: catalog?.allowCustom ?? false,
    discoveryIssue: localCodexBackendInfo(runtime)
      ? "local-server-unavailable"
      : ["codex", "claude", "copilot", "grok", "hermes", "opencode"].includes(runtime)
        ? "discovery-failed" : "runtime-managed",
    scope: runtimeModelInventoryScope(runtime, familiarId),
    provenance,
    freshness: runtimeModelInventoryFreshness(provenance),
    refreshState: runtimeModelInventoryRefreshState(provenance),
    availability: runtimeModelInventoryAvailability(provenance),
  }, provenance);
}

/** One capability-aware inventory for browser, iOS, and other API clients. */
export async function listRuntimeModelInventory(
  runtime: string,
  familiarId?: string | null,
  dependencies: RuntimeModelOptionsDependencies = {},
): Promise<RuntimeModelInventory> {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const fallback = fallbackInventory(canonicalRuntime, familiarId);
  if (dependencies.inventoryRestriction) {
    return { ...fallback, discoveryIssue: dependencies.inventoryRestriction };
  }
  const degraded = canonicalRuntime === "hermes"
    ? withProvenance(fallback, "runtime-managed", [])
    : fallback;
  try {
    let result: {
      models: RuntimeModelOption[];
      provenance: RuntimeModelInventoryProvenance;
    } | null = null;
    if (canonicalRuntime === "codex") {
      if (dependencies.allowCliInventory === false) return degraded;
      result = await (dependencies.listCodexInventory ?? ((id) => listCliRuntimeModels("codex", id)))(familiarId);
    } else if (canonicalRuntime === "claude") {
      if (dependencies.allowCliInventory === false) return degraded;
      const discovery = dependencies.listClaude
        ? { models: await dependencies.listClaude(familiarId), provenance: "live" as const }
        : await (dependencies.listClaudeInventory ?? ((id) => listCliRuntimeModels("claude", id)))(familiarId);
      result = discovery;
    } else if (canonicalRuntime === "copilot") {
      const discovery = dependencies.listCopilot
        ? { models: await dependencies.listCopilot(familiarId), provenance: "live" as const }
        : await (dependencies.listCopilotInventory ?? listCopilotModelInventory)(familiarId);
      result = discovery;
    } else if (canonicalRuntime === "grok") {
      result = {
        models: await (dependencies.listGrok ?? listGrokModels)(familiarId),
        provenance: "live",
      };
    } else if (canonicalRuntime === "hermes") {
      if (dependencies.allowHermesInventory !== true) return degraded;
      const discovery = dependencies.listHermes
        ? { models: await dependencies.listHermes(familiarId), provenance: "live" as const }
        : await (dependencies.listHermesInventory ?? listHermesModelInventory)(familiarId);
      result = discovery;
    } else if (localCodexBackendInfo(canonicalRuntime)) {
      // Codex local mode lists what the server itself reports. Only chat
      // models with tool support can run Codex's agent loop; a server with
      // none says so rather than offering models that would fail.
      if (dependencies.allowCliInventory === false) return { ...degraded, discoveryIssue: "remote-runtime" };
      const info = localCodexBackendInfo(canonicalRuntime)!;
      const probe = await (dependencies.probeLocalBackend ?? probeLocalCodexBackend)(info);
      if (probe.kind === "invalid-endpoint") return { ...degraded, discoveryIssue: "local-endpoint-invalid" };
      if (probe.kind !== "available") return { ...degraded, discoveryIssue: "local-server-unavailable" };
      const usable = probe.models.filter((model) => model.tools);
      if (usable.length === 0) return { ...degraded, discoveryIssue: "local-no-tool-models" };
      // A model LM Link serves from another computer is offered only with
      // the permission that a server on another computer needs.
      const allowRemote = usable.some((model) => model.lmLink)
        ? await (dependencies.localAllowRemote ?? readLocalAllowRemote)()
        : false;
      const offered = usable.filter((model) => localModelRunsHere(model, allowRemote));
      if (offered.length === 0) return { ...degraded, discoveryIssue: "local-models-on-other-computers" };
      result = {
        models: offered.map((model) => ({ id: localCodexModelId(info, model.name), label: model.name })),
        provenance: "live",
      };
    } else if (
      canonicalRuntime === "opencode" &&
      dependencies.allowOpenCodeInventory === true
    ) {
      result = {
        models: [
          ...await (dependencies.listOpenCode ?? listOpenCodeModels)(familiarId),
        ],
        provenance: "live",
      };
    }

    if (result && result.models.length > 0) {
      const models = sanitizeModels(canonicalRuntime, result.models);
      if (models.length === 0) return degraded;
      return withProvenance(degraded, result.provenance, models);
    }
  } catch {
    return degraded;
  }
  return degraded;
}

/** Compatibility projection for callers that only need the menu entries. */
export async function listRuntimeModelOptions(
  runtime: string,
  familiarId?: string | null,
  dependencies: RuntimeModelOptionsDependencies = {},
): Promise<RuntimeModelOption[]> {
  return (await listRuntimeModelInventory(
    runtime,
    familiarId,
    dependencies,
  )).models;
}
