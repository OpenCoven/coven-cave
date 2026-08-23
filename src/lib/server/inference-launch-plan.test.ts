// @ts-nocheck
import assert from "node:assert/strict";
import { normalizeInferenceRoute } from "../inference-routes.ts";
import { resolveInferenceLaunchPlan } from "./inference-launch-plan.ts";

const gateway = normalizeInferenceRoute({
  id: "codex-claude",
  label: "Claude through Codex gateway",
  harness: "codex",
  provider: "anthropic",
  protocol: "openai-responses",
  supportTier: "compatible-gateway",
  endpoint: "https://gateway.example.com/v1",
  credentialRef: "vault:codex-claude",
  gatewayKind: "litellm",
  enabled: true,
});
assert.ok(gateway);

const configured = resolveInferenceLaunchPlan({
  routes: { "codex-claude": gateway },
  binding: {
    harness: "codex",
    inferenceRouteId: "codex-claude",
  },
  requestedModel: "anthropic/claude-sonnet-4-6",
});
assert.equal(configured.ok, true);
assert.equal(configured.plan.route.id, "codex-claude");
assert.deepEqual(configured.plan.requestedModel, {
  routeId: "codex-claude",
  id: "anthropic/claude-sonnet-4-6",
});
assert.equal(configured.plan.launchModel, "anthropic/claude-sonnet-4-6");
assert.equal(configured.plan.resumeSafe, true);

const legacyNative = resolveInferenceLaunchPlan({
  routes: {},
  binding: { harness: "claude-code" },
  requestedModel: null,
  existingConversation: {
    harness: "claude",
  },
});
assert.equal(legacyNative.ok, true);
assert.equal(legacyNative.plan.route.id, "native:claude");
assert.equal(
  legacyNative.plan.resumeSafe,
  true,
  "legacy conversations derive the same implicit native route",
);

const unresolvedPreviousRoute = resolveInferenceLaunchPlan({
  routes: {},
  binding: { harness: "codex" },
  requestedModel: "openai/gpt-5.6-sol",
  existingConversation: {
    harness: "codex",
    inferenceRouteId: "removed-route",
  },
});
assert.equal(unresolvedPreviousRoute.ok, true);
assert.equal(
  unresolvedPreviousRoute.plan.resumeSafe,
  false,
  "an unresolved previous route fails closed instead of reusing its native session",
);

const switchedRoute = resolveInferenceLaunchPlan({
  routes: { "codex-claude": gateway },
  binding: {
    harness: "codex",
    inferenceRouteId: "codex-claude",
  },
  requestedModel: "anthropic/claude-sonnet-4-6",
  existingConversation: {
    harness: "codex",
    inferenceRouteId: "native:codex",
  },
});
assert.equal(switchedRoute.ok, true);
assert.equal(switchedRoute.plan.resumeSafe, false);
assert.equal(switchedRoute.plan.resumeReason, "inference-route-changed");

const changedTranslation = resolveInferenceLaunchPlan({
  routes: { "codex-claude": gateway },
  binding: {
    harness: "codex",
    inferenceRouteId: "codex-claude",
  },
  requestedModel: "anthropic/claude-sonnet-4-6",
  existingConversation: {
    harness: "codex",
    inferenceRouteId: "codex-claude",
    inferenceRouteFingerprint: configured.plan.fingerprint,
  },
  translationMode: "provider-alias",
});
assert.equal(changedTranslation.ok, true);
assert.equal(
  changedTranslation.plan.resumeSafe,
  false,
  "a changed model translation contract invalidates native resume",
);

const invalid = resolveInferenceLaunchPlan({
  routes: {},
  binding: {
    harness: "copilot",
    inferenceRouteId: "missing",
    hasInvalidInferenceRouteBinding: true,
  },
  requestedModel: "anthropic/claude-sonnet-4-6",
});
assert.deepEqual(invalid, {
  ok: false,
  code: "route-not-found",
  message: "The selected inference route is unavailable.",
});

console.log("inference-launch-plan.test.ts: ok");
