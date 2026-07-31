import { canonicalHarnessId } from "../harness-adapters.ts";
import {
  catalogForRuntime,
  type RuntimeModelOption,
} from "../runtime-models.ts";
import { listClaudeModelInventory, listClaudeModels } from "./claude-models.ts";
import { listCopilotModelInventory, listCopilotModels } from "./copilot-models.ts";
import { listGrokModels } from "./grok-models.ts";
import { listOpenCodeModels } from "./opencode-models.ts";

export type RuntimeModelOptionsDependencies = {
  allowOpenCodeInventory?: boolean;
  listClaude?: typeof listClaudeModels;
  listCopilot?: typeof listCopilotModels;
  listClaudeInventory?: typeof listClaudeModelInventory;
  listCopilotInventory?: typeof listCopilotModelInventory;
  listGrok?: typeof listGrokModels;
  listOpenCode?: typeof listOpenCodeModels;
};

export type RuntimeModelInventoryProvenance =
  | "live"
  | "cached"
  | "fallback"
  | "runtime-managed"
  | "unavailable";

export type RuntimeModelInventory = {
  runtime: string;
  models: RuntimeModelOption[];
  provenance: RuntimeModelInventoryProvenance;
  defaultOwner: "cave" | "runtime";
  allowCustom: boolean;
};

function fallbackInventory(runtime: string): RuntimeModelInventory {
  const catalog = catalogForRuntime(runtime);
  const models = [...(catalog?.models ?? [])];
  return {
    runtime,
    models,
    provenance:
      models.length > 0
        ? "fallback"
        : catalog?.defaultOwner === "runtime"
          ? "runtime-managed"
          : "unavailable",
    defaultOwner: catalog?.defaultOwner ?? "runtime",
    allowCustom: catalog?.allowCustom ?? false,
  };
}

/** One capability-aware inventory for browser, iOS, and other API clients. */
export async function listRuntimeModelInventory(
  runtime: string,
  familiarId?: string | null,
  dependencies: RuntimeModelOptionsDependencies = {},
): Promise<RuntimeModelInventory> {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const fallback = fallbackInventory(canonicalRuntime);
  try {
    if (canonicalRuntime === "claude") {
      const result = dependencies.listClaude
        ? { models: await dependencies.listClaude(familiarId), provenance: "live" as const }
        : await (dependencies.listClaudeInventory ?? listClaudeModelInventory)(familiarId);
      return result.models.length > 0
        ? { ...fallback, models: [...result.models], provenance: result.provenance }
        : fallback;
    }
    if (canonicalRuntime === "copilot") {
      const result = dependencies.listCopilot
        ? { models: await dependencies.listCopilot(familiarId), provenance: "live" as const }
        : await (dependencies.listCopilotInventory ?? listCopilotModelInventory)(familiarId);
      return result.models.length > 0
        ? { ...fallback, models: [...result.models], provenance: result.provenance }
        : fallback;
    }
    if (canonicalRuntime === "grok") {
      const models = await (dependencies.listGrok ?? listGrokModels)(familiarId);
      return models.length > 0
        ? { ...fallback, models: [...models], provenance: "live" }
        : fallback;
    }
    // Hermes can be configured against providers other than OpenAI (notably
    // OpenRouter). Its static OpenAI seed is therefore never an authenticated
    // inventory for a familiar-scoped request; defer to the configured CLI
    // rather than exposing the wrong provider's models.
    if (canonicalRuntime === "hermes") {
      return { ...fallback, models: [], provenance: "runtime-managed" };
    }
    if (
      canonicalRuntime === "opencode" &&
      dependencies.allowOpenCodeInventory === true
    ) {
      const models = [
        ...await (dependencies.listOpenCode ?? listOpenCodeModels)(familiarId),
      ];
      return models.length > 0
        ? { ...fallback, models, provenance: "live" }
        : fallback;
    }
  } catch {
    return fallback;
  }
  return fallback;
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
