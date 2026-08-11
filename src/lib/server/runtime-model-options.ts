import { canonicalHarnessId } from "../harness-adapters.ts";
import { cleanModelId, isSyntheticLocalModel } from "../chat-model-state.ts";
import {
  catalogForRuntime,
  runtimeModelInventoryAvailability,
  runtimeModelInventoryFreshness,
  runtimeModelInventoryRefreshState,
  runtimeModelInventoryScope,
  type RuntimeModelInventory,
  type RuntimeModelInventoryProvenance,
  type RuntimeModelOption,
} from "../runtime-models.ts";
import { listClaudeModelInventory, listClaudeModels } from "./claude-models.ts";
import { listCopilotModelInventory, listCopilotModels } from "./copilot-models.ts";
import { listGrokModels } from "./grok-models.ts";
import {
  listHermesModelInventory,
  listHermesModels,
} from "./hermes-models.ts";
import { listOpenCodeModels } from "./opencode-models.ts";

export type RuntimeModelOptionsDependencies = {
  allowOpenCodeInventory?: boolean;
  /** Hermes API discovery is valid only for a bare, local binding. Callers
   * that resolved familiar profile/SSH state opt in explicitly. */
  allowHermesInventory?: boolean;
  listClaude?: typeof listClaudeModels;
  listCopilot?: typeof listCopilotModels;
  listClaudeInventory?: typeof listClaudeModelInventory;
  listCopilotInventory?: typeof listCopilotModelInventory;
  listGrok?: typeof listGrokModels;
  listHermes?: typeof listHermesModels;
  listHermesInventory?: typeof listHermesModelInventory;
  listOpenCode?: typeof listOpenCodeModels;
};

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
    models.set(id, { id, label });
  }
  return [...models.values()];
}

function withProvenance(
  inventory: RuntimeModelInventory,
  provenance: RuntimeModelInventoryProvenance,
  models: RuntimeModelOption[] = inventory.models,
): RuntimeModelInventory {
  return {
    ...inventory,
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
  const models = [...(catalog?.models ?? [])];
  const provenance: RuntimeModelInventoryProvenance =
    models.length > 0
      ? "fallback"
      : catalog?.defaultOwner === "runtime"
        ? "runtime-managed"
        : "unavailable";
  return withProvenance({
    runtime,
    models,
    defaultOwner: catalog?.defaultOwner ?? "runtime",
    allowCustom: catalog?.allowCustom ?? false,
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
  const degraded = canonicalRuntime === "hermes"
    ? withProvenance(fallback, "runtime-managed", [])
    : fallback;
  try {
    let result: {
      models: RuntimeModelOption[];
      provenance: RuntimeModelInventoryProvenance;
    } | null = null;
    if (canonicalRuntime === "claude") {
      const discovery = dependencies.listClaude
        ? { models: await dependencies.listClaude(familiarId), provenance: "live" as const }
        : await (dependencies.listClaudeInventory ?? listClaudeModelInventory)(familiarId);
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
