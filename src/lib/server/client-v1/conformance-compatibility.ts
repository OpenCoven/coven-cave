import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_MIN_CLIENT_VERSION,
} from "./contract.ts";

/**
 * Next injects this value from the build environment. A normal `pnpm build`
 * writes "0", so a runtime selector cannot activate this control in a
 * production artifact.
 */
export const CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED =
  process.env.COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED === "1";

export const CLIENT_V1_COMPATIBILITY_PRESET_ENV =
  "COVEN_CAVE_CLIENT_V1_COMPATIBILITY_PRESET";

export type ClientV1CompatibilityOverride = {
  kind: "override";
  apiVersion: string;
  minimumClientVersion: string;
};

export type ClientV1Compatibility =
  | { kind: "disabled" }
  | { kind: "default" }
  | ClientV1CompatibilityOverride
  | { kind: "invalid" };

const PRESETS = Object.freeze({
  "api-major": Object.freeze({
    apiVersion: "2.0",
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
  }),
  "minimum-client": Object.freeze({
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: "999.0.0",
  }),
});

type ClientV1CompatibilityPreset = keyof typeof PRESETS;

function isPreset(value: string): value is ClientV1CompatibilityPreset {
  return Object.prototype.hasOwnProperty.call(PRESETS, value);
}

export function resolveClientV1Compatibility(
  env: Record<string, string | undefined> = process.env,
  enabled = CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED,
): ClientV1Compatibility {
  if (!enabled) return { kind: "disabled" };

  const raw = env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
  if (raw === undefined || raw.trim() === "") return { kind: "default" };

  const preset = raw.trim();
  if (!isPreset(preset)) return { kind: "invalid" };

  return {
    kind: "override",
    ...PRESETS[preset],
  };
}
