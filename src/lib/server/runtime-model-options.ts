import { canonicalHarnessId } from "../harness-adapters.ts";
import {
  catalogForRuntime,
  type RuntimeModelOption,
} from "../runtime-models.ts";
import { listClaudeModels } from "./claude-models.ts";
import { listCopilotModels } from "./copilot-models.ts";
import { listOpenCodeModels } from "./opencode-models.ts";

export type RuntimeModelOptionsDependencies = {
  allowOpenCodeInventory?: boolean;
  listClaude?: typeof listClaudeModels;
  listCopilot?: typeof listCopilotModels;
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
      const models = await (dependencies.listClaude ?? listClaudeModels)(
        familiarId,
      );
      return models.length > 0
        ? { ...fallback, models: [...models], provenance: "live" }
        : fallback;
    }
    if (canonicalRuntime === "copilot") {
      const models = await (dependencies.listCopilot ?? listCopilotModels)(
        familiarId,
      );
      return models.length > 0
        ? { ...fallback, models: [...models], provenance: "live" }
        : fallback;
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
