// @ts-nocheck
import assert from "node:assert/strict";
import {
  HERMES_API_KEY_VAULT_KEY,
  hermesApiEnv,
  hermesApiSetupState,
  resolveHermesApiConfig,
} from "./hermes-api-settings.ts";
import {
  hermesApiUrlRejection,
  normalizeHermesApiUrl,
} from "./hermes-responses-stream.ts";

// ── endpoint validation is the send route's rule, not a looser one ──────────
// The whole point of exposing this as a setting is that a saved value works.
// A validator that accepts more than the transport does would reintroduce the
// exact failure the setting exists to remove: configured, and silently ignored.

assert.equal(normalizeHermesApiUrl("http://127.0.0.1:9119"), "http://127.0.0.1:9119");
assert.equal(normalizeHermesApiUrl("http://127.0.0.1:9119/"), "http://127.0.0.1:9119");
assert.equal(normalizeHermesApiUrl("https://hermes.example.com"), "https://hermes.example.com");
assert.equal(normalizeHermesApiUrl("  https://hermes.example.com  "), "https://hermes.example.com");
assert.equal(normalizeHermesApiUrl("https://hermes.example.com/v1"), "https://hermes.example.com/v1");

// `localhost` is resolver-controlled: hosts-file or local DNS policy can point
// it off-box, which would put prompts and a bearer key on the network. Only a
// literal loopback address may drop TLS.
assert.equal(normalizeHermesApiUrl("http://localhost:9119"), null);
assert.equal(normalizeHermesApiUrl("http://hermes.example.com"), null);
assert.equal(normalizeHermesApiUrl("https://user:pw@hermes.example.com"), null);
assert.equal(normalizeHermesApiUrl("https://hermes.example.com?token=x"), null);
assert.equal(normalizeHermesApiUrl("https://hermes.example.com#frag"), null);
assert.equal(normalizeHermesApiUrl("ftp://hermes.example.com"), null);
assert.equal(normalizeHermesApiUrl("not a url"), null);
assert.equal(normalizeHermesApiUrl(""), null);
assert.equal(normalizeHermesApiUrl(undefined), null);

// Every rejection carries a reason. A settings field that only says "invalid"
// is a guessing game, especially for the loopback-vs-hostname rule.
for (const bad of [
  "http://localhost:9119",
  "http://hermes.example.com",
  "https://user:pw@hermes.example.com",
  "https://hermes.example.com?token=x",
  "ftp://hermes.example.com",
  "not a url",
  "",
]) {
  const reason = hermesApiUrlRejection(bad);
  assert.ok(reason && reason.length > 0, `"${bad}" must be rejected with a reason`);
}
assert.equal(hermesApiUrlRejection("http://127.0.0.1:9119"), null);
assert.equal(hermesApiUrlRejection("https://hermes.example.com"), null);

// The two must never disagree: anything with a rejection reason must fail
// normalization, and anything that normalizes must have no rejection reason.
for (const candidate of [
  "http://127.0.0.1:9119",
  "https://hermes.example.com",
  "http://localhost:9119",
  "http://10.0.0.4:9119",
  "https://hermes.example.com#frag",
  "",
  "garbage",
]) {
  assert.equal(
    normalizeHermesApiUrl(candidate) === null,
    hermesApiUrlRejection(candidate) !== null,
    `validator and explainer disagree about "${candidate}"`,
  );
}

// ── precedence: what a person typed beats a stale shell export ──────────────

assert.deepEqual(
  hermesApiEnv({ HERMES_API_URL: "https://ambient.example.com", HERMES_API_KEY: "k" }, "https://bound.example.com"),
  { HERMES_API_URL: "https://bound.example.com", HERMES_API_KEY: "k" },
);
// No binding → the ambient value still works, so existing env-configured
// installs keep running untouched.
assert.deepEqual(
  hermesApiEnv({ HERMES_API_URL: "https://ambient.example.com", HERMES_API_KEY: "k" }, undefined),
  { HERMES_API_URL: "https://ambient.example.com", HERMES_API_KEY: "k" },
);
assert.deepEqual(
  hermesApiEnv({ HERMES_API_URL: "https://ambient.example.com", HERMES_API_KEY: "k" }, "   "),
  { HERMES_API_URL: "https://ambient.example.com", HERMES_API_KEY: "k" },
);

const resolved = resolveHermesApiConfig({ HERMES_API_KEY: "secret" }, "http://127.0.0.1:9119");
assert.deepEqual(resolved, { baseUrl: "http://127.0.0.1:9119", apiKey: "secret" });

// A bound endpoint with no key stays on the CLI: half a configuration is not
// a configuration.
assert.equal(resolveHermesApiConfig({}, "http://127.0.0.1:9119"), null);
// A key with a rejected endpoint likewise never reaches fetch().
assert.equal(resolveHermesApiConfig({ HERMES_API_KEY: "secret" }, "http://localhost:9119"), null);
// A binding cannot rescue a control-character key.
assert.equal(resolveHermesApiConfig({ HERMES_API_KEY: "bad\nkey" }, "http://127.0.0.1:9119"), null);

// ── setup state: what the card renders ─────────────────────────────────────

const off = hermesApiSetupState({
  bindingUrl: undefined,
  ambientUrl: undefined,
  keyConfigured: false,
  keyGrantedToFamiliar: false,
  hasHermesProfile: false,
});
assert.equal(off.active, false);
assert.equal(off.url, "");
assert.equal(off.urlFromEnvironment, false);

const on = hermesApiSetupState({
  bindingUrl: "http://127.0.0.1:9119",
  ambientUrl: undefined,
  keyConfigured: true,
  keyGrantedToFamiliar: true,
  hasHermesProfile: false,
});
assert.equal(on.active, true);
assert.equal(on.url, "http://127.0.0.1:9119");

// A key that exists but is scoped to OTHER familiars is not this familiar's
// key. harnessSpawnEnv subtracts it at spawn time, so reporting "on" here
// would promise tool bubbles that never arrive.
const ungranted = hermesApiSetupState({
  bindingUrl: "http://127.0.0.1:9119",
  ambientUrl: undefined,
  keyConfigured: true,
  keyGrantedToFamiliar: false,
  hasHermesProfile: false,
});
assert.equal(ungranted.active, false);

// The trap this state exists to surface: a profile-bound familiar always runs
// through the CLI, so a complete, valid configuration is still inert.
const blocked = hermesApiSetupState({
  bindingUrl: "http://127.0.0.1:9119",
  ambientUrl: undefined,
  keyConfigured: true,
  keyGrantedToFamiliar: true,
  hasHermesProfile: true,
});
assert.equal(blocked.blockedByProfile, true);
assert.equal(blocked.active, false, "a profile binding must not report an active API transport");

// An ambient endpoint is reported as a source, never echoed into `url` — the
// form must not re-save the machine's env value as this familiar's binding.
const ambient = hermesApiSetupState({
  bindingUrl: undefined,
  ambientUrl: "https://ambient.example.com",
  keyConfigured: true,
  keyGrantedToFamiliar: true,
  hasHermesProfile: false,
});
assert.equal(ambient.url, "");
assert.equal(ambient.urlFromEnvironment, true);
assert.equal(ambient.active, true);

assert.equal(HERMES_API_KEY_VAULT_KEY, "HERMES_API_KEY");

console.log("hermes-api-settings tests passed");
