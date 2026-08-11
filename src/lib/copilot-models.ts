import { modelLabel } from "./model-label.ts";
import type { RuntimeModelOption } from "./runtime-models.ts";

const COPILOT_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_MODEL_LABEL_LENGTH = 200;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function enabledByPolicy(model: JsonRecord): boolean {
  if (model.policy === undefined || model.policy === null) return true;
  const policy = record(model.policy);
  return policy?.state === "enabled";
}

function safeLabel(value: unknown, id: string): string {
  if (typeof value === "string") {
    const label = value.trim();
    if (
      label &&
      label.length <= MAX_MODEL_LABEL_LENGTH &&
      !/[\u0000-\u001f\u007f]/.test(label)
    ) {
      return label;
    }
  }
  return modelLabel(id) || id;
}

/** Convert the account- and policy-scoped `models.list` response into Cave's
 * namespaced model options. Invalid responses fail closed rather than looking
 * like a successful empty account inventory. */
export function normalizeCopilotModels(response: unknown): RuntimeModelOption[] {
  const models = record(response)?.models;
  if (!Array.isArray(models)) return [];

  const options: RuntimeModelOption[] = [
    { id: "github/auto", label: "Auto (Copilot picks)" },
  ];
  const seen = new Set(["auto"]);
  for (const value of models) {
    const model = record(value);
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (
      !model ||
      !id ||
      id.length > MAX_MODEL_ID_LENGTH ||
      !COPILOT_MODEL_ID.test(id) ||
      seen.has(id) ||
      !enabledByPolicy(model)
    ) {
      continue;
    }
    seen.add(id);
    options.push({ id: `github/${id}`, label: safeLabel(model.name, id) });
  }
  return options;
}
