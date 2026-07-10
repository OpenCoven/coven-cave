import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deriveKind,
  type CraftSpecification,
  type PluginManifest,
} from "../marketplace-catalog.ts";
import type {
  CraftComponentDefinition,
  CraftDefinition,
} from "./craft-install.ts";

const CRAFT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type CatalogPlugin = PluginManifest & {
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
  version?: unknown;
  description?: unknown;
  craft?: unknown;
};

function requiredConfig(plugin: PluginManifest): string[] {
  return Object.values(plugin.userConfig ?? {})
    .filter((field) => field?.required === true && typeof field.env === "string" && field.env.length > 0)
    .map((field) => field.env as string);
}

function componentDefinition(plugin: CatalogPlugin): CraftComponentDefinition | null {
  if (typeof plugin.name !== "string" || !CRAFT_ID_RE.test(plugin.name)) return null;
  return {
    id: plugin.name,
    displayName: typeof plugin.displayName === "string" ? plugin.displayName : plugin.name,
    version: typeof plugin.version === "string" ? plugin.version : "0.0.0",
    kind: deriveKind(plugin),
    requiredConfig: requiredConfig(plugin),
  };
}

export async function loadCraftDefinition(
  id: string,
  marketplaceDir = path.join(process.cwd(), "marketplace"),
): Promise<CraftDefinition | null> {
  if (!CRAFT_ID_RE.test(id)) return null;

  let plugins: CatalogPlugin[];
  try {
    const parsed = JSON.parse(
      await readFile(path.join(marketplaceDir, "catalog.json"), "utf8"),
    ) as { plugins?: unknown };
    if (!Array.isArray(parsed.plugins)) return null;
    plugins = parsed.plugins as CatalogPlugin[];
  } catch {
    return null;
  }

  const entry = plugins.find((plugin) => plugin.name === id);
  if (
    !entry
    || entry.kind !== "craft"
    || typeof entry.displayName !== "string"
    || typeof entry.version !== "string"
    || typeof entry.description !== "string"
    || !entry.craft
    || typeof entry.craft !== "object"
    || (entry.craft as { schemaVersion?: unknown }).schemaVersion !== "opencoven.craft.v1"
  ) {
    return null;
  }

  const craft = entry.craft as CraftSpecification;
  const referenced = [...craft.components.required, ...craft.components.optional];
  const components: Record<string, CraftComponentDefinition> = {};
  for (const componentId of referenced) {
    const source = plugins.find((plugin) => plugin.name === componentId && plugin.kind !== "craft");
    if (!source) continue;
    const component = componentDefinition(source);
    if (component) components[componentId] = component;
  }

  return {
    id,
    displayName: entry.displayName,
    description: entry.description,
    version: entry.version,
    craft,
    components,
  };
}
