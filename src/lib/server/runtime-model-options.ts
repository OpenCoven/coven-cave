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

/** One server-owned model inventory for browser, iOS, and other API clients. */
export async function listRuntimeModelOptions(
  runtime: string,
  familiarId?: string | null,
  dependencies: RuntimeModelOptionsDependencies = {},
): Promise<RuntimeModelOption[]> {
  const canonicalRuntime = canonicalHarnessId(runtime);
  const seed = [...(catalogForRuntime(canonicalRuntime)?.models ?? [])];
  try {
    if (canonicalRuntime === "claude") {
      const models = await (dependencies.listClaude ?? listClaudeModels)(
        familiarId,
      );
      return models.length > 0 ? [...models] : seed;
    }
    if (canonicalRuntime === "copilot") {
      const models = await (dependencies.listCopilot ?? listCopilotModels)(
        familiarId,
      );
      return models.length > 0 ? [...models] : seed;
    }
    if (
      canonicalRuntime === "opencode" &&
      dependencies.allowOpenCodeInventory === true
    ) {
      return [
        ...await (dependencies.listOpenCode ?? listOpenCodeModels)(familiarId),
      ];
    }
  } catch {
    return seed;
  }
  return seed;
}
