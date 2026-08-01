/**
 * Hermes API settings — where the structured-transport endpoint and key come
 * from, and who wins when more than one source has an opinion.
 *
 * Cave's chat route already knew how to USE `HERMES_API_URL` /
 * `HERMES_API_KEY`; it had no way to SET them. The values could only arrive as
 * ambient process env or a hand-written vault entry, while the in-chat notice
 * cheerfully told operators to "configure" them. This module is the seam that
 * makes that instruction actionable.
 *
 * Split of storage, deliberately:
 *
 *   - The **endpoint** is not a secret. It lives on the familiar's binding in
 *     cave config, so the settings UI can read it back, show it, and let it be
 *     edited — a write-only endpoint field would be unusable.
 *   - The **key** IS a secret. It lives in the vault, scoped to the familiar,
 *     and is never read back to any client. `harnessSpawnEnv(familiarId)`
 *     already subtracts vault keys the familiar isn't granted, so scoping the
 *     key is what keeps one familiar's Hermes credential out of another's
 *     spawn environment.
 *
 * Both halves converge here into the env pair `hermesApiConfig()` expects, so
 * the send route and the model-state route resolve identically and a setting
 * can never be honoured on one path and ignored on the other.
 */

import { hermesApiConfig, type HermesApiConfig } from "./hermes-responses-stream.ts";

/** The vault key holding the bearer credential. */
export const HERMES_API_KEY_VAULT_KEY = "HERMES_API_KEY";

/** The env name the endpoint is delivered under, for the ambient fallback. */
export const HERMES_API_URL_ENV_KEY = "HERMES_API_URL";

export type HermesApiEnv = {
  HERMES_API_URL: string | undefined;
  HERMES_API_KEY: string | undefined;
};

/**
 * Merge the familiar's configured endpoint over the spawn environment.
 *
 * Precedence is binding-over-ambient and only that way round: the binding is
 * the value a person typed into Cave, so if it loses to a stale shell export
 * the setting appears not to work and there is nothing on screen explaining
 * why. An empty binding falls through to the ambient value, which keeps every
 * existing env-configured install working untouched.
 */
export function hermesApiEnv(
  env: Partial<Record<"HERMES_API_URL" | "HERMES_API_KEY", string | undefined>>,
  bindingUrl?: string | null,
): HermesApiEnv {
  const configured = bindingUrl?.trim();
  return {
    HERMES_API_URL: configured || env.HERMES_API_URL,
    HERMES_API_KEY: env.HERMES_API_KEY,
  };
}

/** The resolved transport config, or null to stay on the CLI fallback. */
export function resolveHermesApiConfig(
  env: Partial<Record<"HERMES_API_URL" | "HERMES_API_KEY", string | undefined>>,
  bindingUrl?: string | null,
): HermesApiConfig | null {
  return hermesApiConfig(hermesApiEnv(env, bindingUrl));
}

/**
 * What the settings UI needs to render, with no secret in it.
 *
 * `blockedByProfile` is the trap this exists to surface: the send route only
 * consults the API transport when the familiar has NO bound Hermes profile
 * (`!binding.hermesProfile`). Without this flag a profile-bound familiar would
 * accept a perfectly valid endpoint and key, save both, and still show the
 * "tool activity unavailable" notice on every turn — configuration that reads
 * as applied and is in fact dead.
 */
export type HermesApiSetupState = {
  /** The configured endpoint, or "" when it falls back to ambient env. */
  url: string;
  /** True when an endpoint arrives from the process env rather than config. */
  urlFromEnvironment: boolean;
  /** Whether a key is present. The value itself never crosses this boundary. */
  keyConfigured: boolean;
  /** Whether the key's vault grant covers this familiar. */
  keyGrantedToFamiliar: boolean;
  /** Both halves resolve AND the runtime would actually use them. */
  active: boolean;
  /** A bound Hermes profile makes the API transport unreachable. */
  blockedByProfile: boolean;
};

export function hermesApiSetupState(input: {
  bindingUrl?: string | null;
  ambientUrl?: string | undefined;
  keyConfigured: boolean;
  keyGrantedToFamiliar: boolean;
  hasHermesProfile: boolean;
}): HermesApiSetupState {
  const configured = input.bindingUrl?.trim() ?? "";
  const ambient = input.ambientUrl?.trim() ?? "";
  const effective = configured || ambient;
  const usable = Boolean(effective) && input.keyConfigured && input.keyGrantedToFamiliar;
  return {
    url: configured,
    urlFromEnvironment: !configured && Boolean(ambient),
    keyConfigured: input.keyConfigured,
    keyGrantedToFamiliar: input.keyGrantedToFamiliar,
    active: usable && !input.hasHermesProfile,
    blockedByProfile: input.hasHermesProfile,
  };
}
