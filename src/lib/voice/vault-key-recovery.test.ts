// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_VAULT_KEY_BY_PROVIDER,
  isVoiceKeyErrorMessage,
  voiceRecoveryVaultKey,
} from "./vault-key-recovery.ts";

// ── Provider → vault key map ─────────────────────────────────────────────────

test("every keyed provider maps to its vault key; keyless providers do not", () => {
  assert.equal(VOICE_VAULT_KEY_BY_PROVIDER.openai, "OPENAI_API_KEY");
  assert.equal(VOICE_VAULT_KEY_BY_PROVIDER.gemini, "GOOGLE_API_KEY");
  assert.equal(VOICE_VAULT_KEY_BY_PROVIDER.elevenlabs, "ELEVENLABS_API_KEY");
  assert.equal(VOICE_VAULT_KEY_BY_PROVIDER.local, undefined);
  assert.equal(VOICE_VAULT_KEY_BY_PROVIDER.familiar, undefined);
});

// ── voiceRecoveryVaultKey ────────────────────────────────────────────────────

test("an explicit server-provided missingKey always wins", () => {
  assert.equal(
    voiceRecoveryVaultKey({
      errorCode: "provider_mint_failed",
      missingKey: "OPENAI_API_KEY",
      providerId: "elevenlabs",
    }),
    "OPENAI_API_KEY",
  );
});

test("ElevenLabs key codes name their vault key even without a provider", () => {
  // The TTS proxy can reject the key mid-call, after a clean mint — the
  // PROVIDER_ERROR path carries only the code.
  assert.equal(
    voiceRecoveryVaultKey({ errorCode: "elevenlabs_key_invalid" }),
    "ELEVENLABS_API_KEY",
  );
  assert.equal(
    voiceRecoveryVaultKey({ errorCode: "elevenlabs_key_missing" }),
    "ELEVENLABS_API_KEY",
  );
});

test("an unauthorized SDP exchange resolves through the provider map", () => {
  assert.equal(
    voiceRecoveryVaultKey({ errorCode: "sdp_exchange_failed_401", providerId: "openai" }),
    "OPENAI_API_KEY",
  );
  // Keyless providers have nothing to fix in the vault.
  assert.equal(
    voiceRecoveryVaultKey({ errorCode: "sdp_exchange_failed_401", providerId: "local" }),
    null,
  );
  // No provider, no inference.
  assert.equal(voiceRecoveryVaultKey({ errorCode: "sdp_exchange_failed_401" }), null);
});

test("vault_key_unresolved falls back to the provider map when missingKey was dropped", () => {
  assert.equal(
    voiceRecoveryVaultKey({ errorCode: "vault_key_unresolved", providerId: "elevenlabs" }),
    "ELEVENLABS_API_KEY",
  );
});

test("non-key failures never offer a key editor", () => {
  for (const errorCode of [
    "network",
    "microphone_denied",
    "internal",
    "connect_failed",
    "not_implemented",
    "elevenlabs_unreachable",
    "elevenlabs_probe_failed",
    "sdp_exchange_failed_400",
    "familiar_brain_failed",
    undefined,
  ]) {
    assert.equal(
      voiceRecoveryVaultKey({ errorCode, providerId: "elevenlabs" }),
      null,
      `expected no vault key for ${errorCode}`,
    );
  }
});

// ── isVoiceKeyErrorMessage ───────────────────────────────────────────────────

test("free-text credential failures read as key errors", () => {
  assert.equal(isVoiceKeyErrorMessage("Incorrect API key provided: sk-abc***"), true);
  assert.equal(isVoiceKeyErrorMessage("invalid_api_key"), true);
  assert.equal(isVoiceKeyErrorMessage("provider_http_401"), true);
  assert.equal(isVoiceKeyErrorMessage("401 Unauthorized"), true);
  assert.equal(isVoiceKeyErrorMessage("Request unauthorized"), true);
});

test("non-credential failures do not read as key errors", () => {
  assert.equal(isVoiceKeyErrorMessage("quota exhausted"), false);
  assert.equal(isVoiceKeyErrorMessage("provider_http_429"), false);
  assert.equal(isVoiceKeyErrorMessage("connection refused"), false);
  // A bare 401 inside a longer number is not an auth status.
  assert.equal(isVoiceKeyErrorMessage("error 14012 while dialing"), false);
});
