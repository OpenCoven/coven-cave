// @ts-nocheck
import assert from "node:assert/strict";
import {
  implicitNativeInferenceRoute,
  inferenceRouteFingerprint,
  normalizeInferenceRoute,
  resolveInferenceRoute,
} from "./inference-routes.ts";

const native = implicitNativeInferenceRoute("claude-code");
assert.deepEqual(native, {
  id: "native:claude",
  label: "Claude Code account",
  harness: "claude",
  provider: "anthropic",
  protocol: "runtime-managed",
  supportTier: "native-account",
  enabled: true,
});

assert.deepEqual(
  normalizeInferenceRoute({
    id: "team-anthropic",
    label: "Team Anthropic",
    harness: "copilot-cli",
    provider: "anthropic",
    protocol: "anthropic-messages",
    supportTier: "native-byok",
    endpoint: "https://api.anthropic.com/",
    credentialRef: "vault:copilot-anthropic",
    enabled: true,
    apiKey: "must-not-persist",
  }),
  {
    id: "team-anthropic",
    label: "Team Anthropic",
    harness: "copilot",
    provider: "anthropic",
    protocol: "anthropic-messages",
    supportTier: "native-byok",
    endpoint: "https://api.anthropic.com",
    credentialRef: "vault:copilot-anthropic",
    enabled: true,
  },
  "route normalization keeps non-secret launch identity and drops unknown secret-shaped fields",
);

assert.equal(
  normalizeInferenceRoute({
    id: "bad-endpoint",
    label: "Bad endpoint",
    harness: "codex",
    provider: "anthropic",
    protocol: "openai-responses",
    supportTier: "compatible-gateway",
    endpoint: "http://example.com/v1",
    enabled: true,
  }),
  null,
  "non-loopback plaintext endpoints fail closed",
);
assert.equal(
  normalizeInferenceRoute({
    id: "native:codex",
    label: "Shadow native route",
    harness: "codex",
    provider: "anthropic",
    protocol: "openai-responses",
    supportTier: "compatible-gateway",
    endpoint: "https://gateway.example.com/v1",
    enabled: true,
  }),
  null,
  "configured routes cannot shadow reserved implicit native route ids",
);
assert.equal(
  normalizeInferenceRoute({
    id: "local-ipv6",
    label: "Local IPv6 gateway",
    harness: "codex",
    provider: "local",
    protocol: "openai-responses",
    supportTier: "compatible-gateway",
    endpoint: "http://[::1]:4000/v1/",
    enabled: true,
  })?.endpoint,
  "http://[::1]:4000/v1",
  "IPv6 loopback endpoints may use plaintext for local development",
);

const configured = normalizeInferenceRoute({
  id: "team-anthropic",
  label: "Team Anthropic",
  harness: "copilot",
  provider: "anthropic",
  protocol: "anthropic-messages",
  supportTier: "native-byok",
  endpoint: "https://api.anthropic.com",
  credentialRef: "vault:copilot-anthropic",
  enabled: true,
});
assert.ok(configured);
assert.deepEqual(
  resolveInferenceRoute(
    { "team-anthropic": configured },
    { harness: "copilot-cli", inferenceRouteId: "team-anthropic" },
  ),
  { ok: true, route: configured, source: "configured" },
);
assert.deepEqual(
  resolveInferenceRoute(
    { "team-anthropic": { ...configured, enabled: false } },
    {
      harness: "copilot",
      inferenceRouteId: "team-anthropic",
      hasInvalidInferenceRouteBinding: true,
    },
  ),
  {
    ok: false,
    code: "route-disabled",
    message: "The selected inference route is disabled.",
  },
);
assert.equal(
  inferenceRouteFingerprint(configured),
  inferenceRouteFingerprint({ ...configured, label: "Renamed connection" }),
  "presentation copy does not invalidate a native session",
);
assert.notEqual(
  inferenceRouteFingerprint(configured),
  inferenceRouteFingerprint({
    ...configured,
    endpoint: "https://gateway.example.com/v1",
  }),
  "launch authority changes invalidate native resume",
);

const orcarouter = normalizeInferenceRoute({
  id: "orcarouter-gateway",
  label: "OrcaRouter gateway",
  harness: "codex",
  provider: "anthropic",
  protocol: "openai-responses",
  supportTier: "compatible-gateway",
  endpoint: "https://api.orcarouter.ai/v1",
  credentialRef: "vault:orcarouter",
  gatewayKind: "orcarouter",
  enabled: true,
});
assert.ok(orcarouter, "OrcaRouter normalizes as a named gateway kind");
assert.equal(orcarouter.gatewayKind, "orcarouter");
assert.equal(
  inferenceRouteFingerprint(orcarouter),
  inferenceRouteFingerprint({ ...orcarouter, label: "OrcaRouter (renamed)" }),
  "presentation copy does not invalidate an OrcaRouter-gated native session",
);
assert.notEqual(
  inferenceRouteFingerprint(orcarouter),
  inferenceRouteFingerprint({ ...orcarouter, gatewayKind: "openrouter" }),
  "the gateway kind participates in launch identity, mirroring OpenRouter",
);

console.log("inference-routes.test.ts: ok");
