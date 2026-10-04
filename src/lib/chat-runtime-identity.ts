import { cleanModelId, isSyntheticLocalModel } from "./chat-model-state.ts";
import { normalizeRuntimeActivity, type ChatRuntimeActivity } from "./chat-runtime-activity.ts";

/** Display evidence from this launch, separate from selected/forwarded model
 * intent. Null values are explicit gaps, not permission to guess a default. */
export type ChatRuntimeIdentity = {
  schemaVersion: 1;
  harness: string;
  version: string | null;
  model: string | null;
  activity?: ChatRuntimeActivity;
};

export function runtimeIdentityForLaunch(harness: string, version?: string | null, activity?: ChatRuntimeActivity): ChatRuntimeIdentity {
  const safeVersion = version?.trim();
  return {
    schemaVersion: 1,
    harness,
    version: safeVersion && /^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(safeVersion) ? safeVersion : null,
    model: null,
    ...(normalizeRuntimeActivity(activity) ? { activity: normalizeRuntimeActivity(activity) } : {}),
  };
}

/** Call only for a validated native runtime identity field. Requested argv,
 * successful exits, model narration, and tool payloads are not model reports. */
export function withReportedRuntimeModel(identity: ChatRuntimeIdentity, value: unknown): ChatRuntimeIdentity {
  // Frames without a report leave the last observation intact. An explicit
  // unavailable/invalid report invalidates it instead of retaining stale proof.
  if (value === undefined) return identity;
  const model = cleanModelId(value);
  const bare = model?.split("/").at(-1)?.toLowerCase();
  if (!model || model.length > 256 || isSyntheticLocalModel(model, identity.harness) ||
    ["default", "auto", "opus", "sonnet", "haiku", "latest", "unknown"].includes(bare ?? "")) return { ...identity, model: null };
  return { ...identity, model };
}

/** Validate stored server metadata without upgrading legacy model intent into
 * a runtime report. Unknown schema versions stay unavailable. */
export function normalizeRuntimeIdentity(value: unknown, harness: string): ChatRuntimeIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const report = value as Record<string, unknown>;
  if (report.schemaVersion !== 1 || report.harness !== harness) return undefined;
  const launch = runtimeIdentityForLaunch(harness, typeof report.version === "string" ? report.version : null, normalizeRuntimeActivity(report.activity));
  return withReportedRuntimeModel(launch, report.model);
}
