/**
 * A runtime-neutral description of controls that may be offered for one
 * selected model.  This is deliberately separate from model inventory: an
 * inventory answer says what can be selected, while this contract says what a
 * selected model can actually honour for this turn.
 */
export type ModelControlFamily =
  | "reasoning"
  | "performance"
  | "verbosity"
  | "output-limit"
  | "modalities"
  | "tool-support";

export type ModelControlDelivery =
  | "native-provider"
  | "runtime-cli"
  | "prompt-only"
  | "unsupported";

export type ModelControlValue = {
  value: string;
  label: string;
};

export type ModelControlCapability = {
  family: ModelControlFamily;
  label: string;
  delivery: ModelControlDelivery;
  values: readonly ModelControlValue[];
  /** Provider/CLI wire name. Never expose this as user-facing copy. */
  parameter?: string;
};

export type ModelControlValues = Partial<Record<ModelControlFamily, string>>;

const reasoning = (delivery: ModelControlDelivery, parameter?: string): ModelControlCapability => ({
  family: "reasoning",
  label: delivery === "prompt-only" ? "Reasoning guidance" : "Reasoning",
  delivery,
  values: [
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
  ...(parameter ? { parameter } : {}),
});

const verbosity = (delivery: ModelControlDelivery, parameter?: string): ModelControlCapability => ({
  family: "verbosity",
  label: delivery === "prompt-only" ? "Verbosity guidance" : "Verbosity",
  delivery,
  values: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
  ...(parameter ? { parameter } : {}),
});

/**
 * Return only controls Cave can truthfully deliver for this runtime/model.
 * Unknown and legacy runtime/model pairs intentionally have no controls: that
 * is safer than silently presenting prompt prose as a provider setting.
 */
export function modelControlCapabilities(
  runtime: string,
  model: string | null | undefined,
): readonly ModelControlCapability[] {
  const canonicalRuntime = runtime.trim().toLowerCase();
  const canonicalModel = model?.trim().toLowerCase() ?? "";

  // Hermes's Responses API transport is OpenAI-compatible only for explicit
  // OpenAI GPT-5 selections. The send route additionally requires that API
  // transport before it emits either parameter.
  if (canonicalRuntime === "hermes" && /^openai\/gpt-5(?:[.-]|$)/.test(canonicalModel)) {
    return [
      reasoning("native-provider", "reasoning.effort"),
      verbosity("native-provider", "text.verbosity"),
    ];
  }

  // Claude currently has no verified non-interactive per-turn CLI flag in the
  // Cave launch contract. Keep an opt-in guidance control distinct from a
  // native setting until that capability is explicitly probed and mapped.
  if (canonicalRuntime === "claude" && canonicalModel) {
    return [reasoning("prompt-only")];
  }

  return [];
}

export function validateModelControlValues(
  capabilities: readonly ModelControlCapability[],
  values: unknown,
): { values: ModelControlValues; rejected: string[] } {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { values: {}, rejected: [] };
  }
  const requested = values as Record<string, unknown>;
  const allowed = new Map(capabilities.map((capability) => [capability.family, capability]));
  const accepted: ModelControlValues = {};
  const rejected: string[] = [];
  for (const [family, value] of Object.entries(requested)) {
    const capability = allowed.get(family as ModelControlFamily);
    if (!capability || capability.delivery === "unsupported" || typeof value !== "string") {
      rejected.push(family);
      continue;
    }
    if (!capability.values.some((candidate) => candidate.value === value)) {
      rejected.push(family);
      continue;
    }
    accepted[capability.family] = value;
  }
  return { values: accepted, rejected };
}

export function promptOnlyModelControls(
  capabilities: readonly ModelControlCapability[],
  values: ModelControlValues,
): ModelControlValues {
  const promptFamilies = new Set(
    capabilities
      .filter((capability) => capability.delivery === "prompt-only")
      .map((capability) => capability.family),
  );
  return Object.fromEntries(
    Object.entries(values).filter(([family]) => promptFamilies.has(family as ModelControlFamily)),
  ) as ModelControlValues;
}
