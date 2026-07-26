// In-place recovery for voice-call connect failures (cave-xz57).
//
// A failed call must never dead-end at "try again": when the failure is
// key-shaped (a missing or rejected vault secret for ElevenLabs, OpenAI, or
// any keyed provider), the call overlay offers an inline editor that saves
// the key to the Vault and retries without leaving the call. This module is
// the single source of truth for which vault key backs each keyed voice
// provider, and for deciding whether an error is fixable by updating it.

/** Vault key backing each keyed voice provider. The "local" and "familiar"
 *  providers mint keyless (their brain is a loopback server or the
 *  familiar's own harness) and deliberately have no entry here. */
export const VOICE_VAULT_KEY_BY_PROVIDER: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};

/** Error codes that name their own vault key, whatever provider raised them
 *  (the ElevenLabs TTS proxy can fail mid-call after a clean mint). */
const KEY_ERROR_VAULT_KEYS: Record<string, string> = {
  elevenlabs_key_invalid: "ELEVENLABS_API_KEY",
  elevenlabs_key_missing: "ELEVENLABS_API_KEY",
};

/** Error codes whose fix is the provider's own vault key. */
const PROVIDER_KEY_ERROR_CODES = new Set([
  // Vault lookup came back empty at mint time.
  "vault_key_unresolved",
  // The WebRTC SDP exchange was rejected as unauthorized — the ephemeral
  // grant's underlying key is bad.
  "sdp_exchange_failed_401",
]);

/**
 * True when a provider's free-text mint failure reads like a credentials
 * problem (OpenAI throws its HTTP error body verbatim, e.g. "Incorrect API
 * key provided: sk-…"), so the session route can still name the vault key.
 */
export function isVoiceKeyErrorMessage(message: string): boolean {
  // Bare "401" only counts when it isn't part of a longer number
  // (provider_http_401 yes, "error 14012" no).
  return /unauthorized|api.?key|(?:^|[^0-9])401(?:[^0-9]|$)/i.test(message);
}

/**
 * The vault key this error can be fixed with in place, or null when updating
 * a key would not help (mic denied, network trouble, unimplemented
 * provider…). An explicit server-provided `missingKey` always wins.
 */
export function voiceRecoveryVaultKey(opts: {
  errorCode?: string;
  missingKey?: string;
  providerId?: string;
}): string | null {
  if (opts.missingKey) return opts.missingKey;
  const code = opts.errorCode ?? "";
  const named = KEY_ERROR_VAULT_KEYS[code];
  if (named) return named;
  if (PROVIDER_KEY_ERROR_CODES.has(code) && opts.providerId) {
    return VOICE_VAULT_KEY_BY_PROVIDER[opts.providerId] ?? null;
  }
  return null;
}
