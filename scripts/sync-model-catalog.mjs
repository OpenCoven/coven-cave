// Generate Cave's static harness model catalogs and context metadata from one
// reviewable support matrix. Live account inventories remain runtime-owned.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MODEL_CATALOG_SOURCE_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "config",
  "runtime-model-catalog.json",
);
export const MODEL_CATALOG_OUTPUT_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "src",
  "lib",
  "runtime-model-catalog.gen.ts",
);

const MODEL_KEY_RE = /^[a-z0-9][a-z0-9.-]*$/;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._:@+-]*$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;
const MODEL_PATH_RE =
  /^[A-Za-z0-9][A-Za-z0-9._:@+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:@+-]*)*$/;
const RUNTIME_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_OWNERS = new Set(["cave", "runtime"]);
const SUPPORTED_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "github",
  "nous",
  "xai",
]);

function rejectUnknownKeys(value, allowed, description) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${description} has unknown field(s): ${unknown.join(", ")}`);
  }
}

function record(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value;
}

function nonEmptyString(value, description) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${description} must be a non-empty printable string`);
  }
  return value.trim();
}

function contextWindow(value, description) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive safe integer`);
  }
  return value;
}

export function compileModelCatalog(document) {
  const source = record(document, "model catalog");
  rejectUnknownKeys(
    source,
    new Set(["schemaVersion", "models", "harnesses", "contextAliases"]),
    "model catalog",
  );
  if (source.schemaVersion !== 1) {
    throw new Error(`unsupported model catalog schemaVersion ${JSON.stringify(source.schemaVersion)}`);
  }

  const models = record(source.models, "models");
  const normalizedModels = new Map();
  const stableIds = new Map();
  for (const [key, value] of Object.entries(models)) {
    if (!MODEL_KEY_RE.test(key)) {
      throw new Error(`model key ${JSON.stringify(key)} must match ${MODEL_KEY_RE}`);
    }
    const model = record(value, `models.${key}`);
    rejectUnknownKeys(
      model,
      new Set(["label", "ids", "contextWindow", "capabilityGated"]),
      `models.${key}`,
    );
    const label = nonEmptyString(model.label, `models.${key}.label`);
    const ids = record(model.ids, `models.${key}.ids`);
    const normalizedIds = {};
    for (const [provider, rawId] of Object.entries(ids)) {
      if (!PROVIDER_RE.test(provider)) {
        throw new Error(`models.${key}.ids provider ${JSON.stringify(provider)} is invalid`);
      }
      const id = nonEmptyString(rawId, `models.${key}.ids.${provider}`);
      if (!MODEL_ID_RE.test(id)) {
        throw new Error(`models.${key}.ids.${provider} ${JSON.stringify(id)} is not a safe bare model id`);
      }
      const stableId = `${provider}/${id}`;
      const existing = stableIds.get(stableId);
      if (existing) {
        throw new Error(`${stableId} is assigned to both ${existing} and ${key}`);
      }
      stableIds.set(stableId, key);
      normalizedIds[provider] = id;
    }
    if (Object.keys(normalizedIds).length === 0) {
      throw new Error(`models.${key}.ids must contain at least one provider id`);
    }
    normalizedModels.set(key, {
      label,
      ids: normalizedIds,
      contextWindow: model.contextWindow === undefined
        ? undefined
        : contextWindow(model.contextWindow, `models.${key}.contextWindow`),
      capabilityGated: model.capabilityGated === true,
    });
    if (
      model.capabilityGated !== undefined &&
      typeof model.capabilityGated !== "boolean"
    ) {
      throw new Error(`models.${key}.capabilityGated must be a boolean`);
    }
  }

  const harnesses = record(source.harnesses, "harnesses");
  const catalog = {};
  for (const [runtime, value] of Object.entries(harnesses)) {
    if (!RUNTIME_RE.test(runtime)) {
      throw new Error(`harness id ${JSON.stringify(runtime)} must match ${RUNTIME_RE}`);
    }
    const harness = record(value, `harnesses.${runtime}`);
    rejectUnknownKeys(
      harness,
      new Set(["provider", "models", "defaultModel", "allowCustom", "defaultOwner"]),
      `harnesses.${runtime}`,
    );
    const provider = harness.provider === null
      ? null
      : nonEmptyString(harness.provider, `harnesses.${runtime}.provider`);
    if (
      provider !== null &&
      (!PROVIDER_RE.test(provider) || !SUPPORTED_PROVIDERS.has(provider))
    ) {
      throw new Error(
        `harnesses.${runtime}.provider ${JSON.stringify(provider)} is not supported`,
      );
    }
    if (!Array.isArray(harness.models)) {
      throw new Error(`harnesses.${runtime}.models must be an array`);
    }
    if (typeof harness.allowCustom !== "boolean") {
      throw new Error(`harnesses.${runtime}.allowCustom must be a boolean`);
    }
    if (!DEFAULT_OWNERS.has(harness.defaultOwner)) {
      throw new Error(`harnesses.${runtime}.defaultOwner must be "cave" or "runtime"`);
    }

    const seenKeys = new Set();
    const options = harness.models.map((rawKey, index) => {
      const key = nonEmptyString(rawKey, `harnesses.${runtime}.models[${index}]`);
      if (seenKeys.has(key)) {
        throw new Error(`harnesses.${runtime}.models repeats ${key}`);
      }
      seenKeys.add(key);
      const model = normalizedModels.get(key);
      if (!model) {
        throw new Error(`harnesses.${runtime}.models references unknown model ${key}`);
      }
      if (model.capabilityGated) {
        throw new Error(
          `harnesses.${runtime}.models cannot publish capability-gated model ${key}`,
        );
      }
      if (!provider) {
        throw new Error(`harnesses.${runtime} cannot list models without a provider`);
      }
      const id = model.ids[provider];
      if (!id) {
        throw new Error(`model ${key} has no ${provider} id required by harness ${runtime}`);
      }
      return { id: `${provider}/${id}`, label: model.label };
    });

    const entry = {
      runtime,
      provider,
      models: options,
    };
    if (harness.defaultModel !== undefined) {
      if (typeof harness.defaultModel !== "string") {
        throw new Error(`harnesses.${runtime}.defaultModel must be a string`);
      }
      if (
        harness.defaultModel &&
        (
          harness.defaultModel.includes("..") ||
          !MODEL_PATH_RE.test(harness.defaultModel)
        )
      ) {
        throw new Error(`harnesses.${runtime}.defaultModel is not a safe model id`);
      }
      if (
        harness.defaultModel &&
        options.length > 0 &&
        !options.some((option) => option.id === harness.defaultModel)
      ) {
        throw new Error(
          `harnesses.${runtime}.defaultModel must reference a listed model`,
        );
      }
      entry.defaultModel = harness.defaultModel;
    }
    entry.allowCustom = harness.allowCustom;
    entry.defaultOwner = harness.defaultOwner;
    catalog[runtime] = entry;
  }
  if (Object.keys(catalog).length === 0) {
    throw new Error("harnesses must contain at least one runtime");
  }

  const contextWindows = {};
  for (const model of normalizedModels.values()) {
    if (model.contextWindow === undefined) continue;
    for (const [provider, id] of Object.entries(model.ids)) {
      contextWindows[`${provider}/${id}`] = model.contextWindow;
    }
  }
  const aliases = record(source.contextAliases ?? {}, "contextAliases");
  for (const [id, value] of Object.entries(aliases)) {
    if (
      id.includes("..") ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@+-]*\/[A-Za-z0-9][A-Za-z0-9._:@+-]*$/.test(id)
    ) {
      throw new Error(`context alias ${JSON.stringify(id)} is not a safe provider/model id`);
    }
    if (contextWindows[id] !== undefined) {
      throw new Error(`context alias ${id} duplicates a generated model id`);
    }
    contextWindows[id] = contextWindow(value, `contextAliases.${id}`);
  }

  return { catalog, contextWindows };
}

export function renderModelCatalog(document, rawSource) {
  const { catalog, contextWindows } = compileModelCatalog(document);
  const sha256 = createHash("sha256").update(rawSource).digest("hex");
  return `// GENERATED by scripts/sync-model-catalog.mjs - do not edit by hand.
// Re-generate with: node scripts/sync-model-catalog.mjs
//
// Source: config/runtime-model-catalog.json
// sha256: ${sha256}

export const MODEL_CATALOG_SOURCE = {
  schemaVersion: 1,
  sha256: ${JSON.stringify(sha256)},
} as const;

export type GeneratedRuntimeProvider =
  | "openai"
  | "anthropic"
  | "github"
  | "nous"
  | "xai"
  | null;

export type GeneratedRuntimeModelCatalog = {
  runtime: string;
  provider: GeneratedRuntimeProvider;
  models: Array<{ id: string; label: string }>;
  defaultModel?: string;
  allowCustom: boolean;
  defaultOwner: "cave" | "runtime";
};

export const GENERATED_RUNTIME_MODEL_CATALOG: Record<
  string,
  GeneratedRuntimeModelCatalog
> = ${JSON.stringify(catalog, null, 2)};

export const GENERATED_MODEL_CONTEXT_WINDOWS: Record<string, number> =
  ${JSON.stringify(contextWindows, null, 2)};
`;
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (check ? 1 : 0)) {
    throw new Error(`unknown arguments: ${argv.join(" ")}`);
  }
  const rawSource = readFileSync(MODEL_CATALOG_SOURCE_PATH, "utf8");
  const next = renderModelCatalog(JSON.parse(rawSource), rawSource);
  const current = existsSync(MODEL_CATALOG_OUTPUT_PATH)
    ? readFileSync(MODEL_CATALOG_OUTPUT_PATH, "utf8")
    : null;

  if (check) {
    if (current !== next) {
      console.error(
        "sync-model-catalog: generated catalog is stale - run `node scripts/sync-model-catalog.mjs`",
      );
      return 1;
    }
    console.log("sync-model-catalog: up to date");
    return 0;
  }
  if (current === next) {
    console.log("sync-model-catalog: no changes");
    return 0;
  }
  writeFileSync(MODEL_CATALOG_OUTPUT_PATH, next);
  console.log(
    `sync-model-catalog: wrote ${path.relative(process.cwd(), MODEL_CATALOG_OUTPUT_PATH)}`,
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`sync-model-catalog: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
