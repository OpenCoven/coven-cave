import { responseMetadataIdentity, type ChatResponseMetadata } from "./chat-response-metadata.ts";
import { normalizeRuntimeActivity, runtimeActivityStatusLines } from "./chat-runtime-activity.ts";

/** One row of the Run details disclosure. A row without a label is a note
 *  (the model application reason) and spans the value column. `gap` marks a
 *  fact the runtime did not report or confirm; the summary counts those so the
 *  gaps stay visible while the disclosure is closed (#6026, #5765). */
export type RunDetailLine = { label?: string; value: string; gap?: boolean };

export type RunDetailGroup = {
  id: "runtime" | "model" | "controls" | "activity";
  label: string;
  lines: RunDetailLine[];
};

export type RunDetails = {
  groups: RunDetailGroup[];
  /** Sighted summary facts after the "Run details" title: runtime, model
   *  state when it is not applied, then the unverified and rejected counts. */
  facts: string[];
  unverified: number;
  rejected: number;
};

/** Exact IDs distinguish providers, deployments, versions, and aliases. */
function modelLabel(model: string): string {
  return model;
}

/** The model application trail is separate from controls: a runtime echo can
 *  prove forwarding without proving provider application, and a runtime-owned
 *  default may intentionally have no model id at all. */
function runtimeAndModelGroups(metadata: ChatResponseMetadata): { runtime: RunDetailLine[]; model: RunDetailLine[]; stateFact: string | null } {
  const requested = metadata.requestedModel;
  const desired = metadata.desiredModel ?? metadata.model;
  const forwarded = metadata.forwardedModel;
  const confirmed = metadata.confirmedModel;
  const identity = responseMetadataIdentity(metadata);
  const runtime: RunDetailLine[] = [
    identity
      ? { label: "Runtime", value: identity.version ? `${identity.harness} ${identity.version}` : `${identity.harness} · Version not reported`, gap: !identity.version }
      : { label: "Runtime", value: "Identity not recorded in this response", gap: true },
    identity?.model
      ? { label: "Runtime-reported model", value: identity.model }
      : { label: "Runtime-reported model", value: "Unavailable", gap: true },
  ];
  const model: RunDetailLine[] = [];
  if (requested !== undefined) model.push({ label: "Requested model", value: requested ? modelLabel(requested) : "Runtime default" });
  if (desired) model.push({ label: "Selected model", value: modelLabel(desired) });
  if (forwarded && forwarded !== desired) model.push({ label: "Forwarded model", value: modelLabel(forwarded) });
  let stateFact: string | null = null;
  if (confirmed && !identity) {
    model.push({ label: "Recorded model", value: modelLabel(confirmed) });
  } else if (metadata.modelApplicationState) {
    const state = metadata.modelApplicationState;
    // The state is its own summary fact ("model pending"), so it is not also
    // counted among the unverified lines.
    model.push({ label: "Model", value: state });
    if (state !== "applied") stateFact = `model ${state}`;
  }
  if (metadata.modelSource) model.push({ label: "Source", value: metadata.modelSource });
  if (metadata.modelApplicationReason && !confirmed) model.push({ value: metadata.modelApplicationReason });
  return { runtime, model, stateFact };
}

/** Per-turn control outcome: requested, prompt guidance, applied, or rejected. */
function controlLines(metadata: ChatResponseMetadata): { lines: RunDetailLine[]; rejected: number } {
  const requested = Object.entries(metadata.requestedControls ?? {});
  const rejected = new Set(metadata.rejectedControlFamilies ?? []);
  const promptOnly = new Set(Object.keys(metadata.promptGuidanceControls ?? {}));
  const forwarded = new Set(Object.keys(metadata.forwardedControls ?? {}));
  const applied = new Set(Object.keys(metadata.appliedControls ?? {}));
  if (!requested.length && !rejected.size) return { lines: [], rejected: 0 };
  const lines: RunDetailLine[] = requested.map(([family, value]) => {
    if (rejected.has(family)) return { label: "Rejected", value: `${family} ${value}` };
    if (promptOnly.has(family)) return { label: "Prompt guidance", value: `${family} ${value}` };
    if (applied.has(family)) return { label: "Applied", value: `${family} ${value}` };
    if (forwarded.has(family)) return { label: "Forwarded — not confirmed", value: `${family} ${value}`, gap: true };
    return { label: "Requested — not confirmed", value: `${family} ${value}`, gap: true };
  });
  for (const family of rejected) {
    if (!requested.some(([requestedFamily]) => requestedFamily === family)) lines.push({ label: "Rejected", value: family });
  }
  return { lines, rejected: rejected.size };
}

/** Availability of Cave's selected display adapter for this turn. Only an
 *  `unknown` state is a gap; unsupported, partial and disabled are facts. */
function activityLines(activity: unknown): RunDetailLine[] {
  const normalized = normalizeRuntimeActivity(activity);
  const texts = runtimeActivityStatusLines(activity);
  if (!normalized) return [{ label: "Activity support", value: "Not recorded", gap: true }];
  const gaps = [normalized.path === "unknown", normalized.tools === "unknown", normalized.reasoning === "unknown"];
  return texts.map((text, index) => {
    const separator = text.indexOf(": ");
    return { label: text.slice(0, separator), value: text.slice(separator + 2), gap: gaps[index] || undefined };
  });
}

export function responseRunDetails(metadata?: ChatResponseMetadata): RunDetails | null {
  if (!metadata) return null;
  const { runtime, model, stateFact } = runtimeAndModelGroups(metadata);
  const controls = controlLines(metadata);
  const identity = responseMetadataIdentity(metadata);
  const activity = activityLines(identity?.activity);
  const groups: RunDetailGroup[] = [
    { id: "runtime", label: "Runtime", lines: runtime },
    ...(model.length ? [{ id: "model" as const, label: "Model", lines: model }] : []),
    ...(controls.lines.length ? [{ id: "controls" as const, label: "Controls", lines: controls.lines }] : []),
    { id: "activity", label: "Activity", lines: activity },
  ];
  const unverified = groups.reduce((count, group) => count + group.lines.filter((line) => line.gap).length, 0);
  const facts = [
    identity ? `${identity.harness}${identity.version ? ` ${identity.version}` : ""}` : "runtime not recorded",
    ...(stateFact ? [stateFact] : []),
    ...(unverified ? [`${unverified} unverified`] : []),
    ...(controls.rejected ? [`${controls.rejected} rejected`] : []),
  ];
  return { groups, facts, unverified, rejected: controls.rejected };
}

/** The closed disclosure's whole text, as a screen reader hears it. */
export function runDetailsSummaryText(details: RunDetails): string {
  return ["Run details", ...details.facts].join(" · ");
}

/** Every line as "Label: value" text, for callers that still want the flat
 *  trail (tests, copy, accessible descriptions). */
export function runDetailsLineTexts(details: RunDetails): string[] {
  return details.groups.flatMap((group) => group.lines.map((line) => line.label ? `${line.label}: ${line.value}` : line.value));
}
