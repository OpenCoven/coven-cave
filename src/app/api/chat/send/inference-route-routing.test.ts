// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /resolveInferenceLaunchPlan\(\{[\s\S]*?routes: config\.inferenceRoutes,[\s\S]*?binding,[\s\S]*?requestedModel: cleanModelId\(desiredModel\),[\s\S]*?existingConversation,[\s\S]*?\}\)/,
  "the send boundary resolves harness and inference route together",
);
assert.match(
  route,
  /code: "inference_route_unavailable"[\s\S]*?inferenceLaunch\.message/,
  "invalid, disabled, or incompatible routes fail before spawn",
);
assert.match(
  route,
  /inferenceRouteId: inferencePlan\.route\.id,[\s\S]*?inferenceRouteFingerprint: inferencePlan\.fingerprint,[\s\S]*?inferenceProvider: inferencePlan\.route\.provider,[\s\S]*?inferenceProtocol: inferencePlan\.route\.protocol,[\s\S]*?inferenceSupportTier: inferencePlan\.route\.supportTier/,
  "response metadata identifies the non-secret inference authority",
);
assert.match(
  route,
  /const inferenceRouteRefreshNeeded = Boolean\([\s\S]*?!inferencePlan\.resumeSafe[\s\S]*?\);[\s\S]*?buildResumeRetryPrompt\(harnessPrompt, existingConversation\)/,
  "route changes start a fresh native session with bounded transcript replay",
);
assert.match(
  route,
  /runtimeAccessRefreshNeeded\s*\|\|\s*inferenceRouteRefreshNeeded\s*\|\|\s*grokFreshSessionForSandbox/,
  "route refresh suppresses the stale native resume token",
);
assert.match(
  route,
  /const freshNativeSessionRequired =[\s\S]*?runtimeAccessRefreshNeeded[\s\S]*?inferenceRouteRefreshNeeded[\s\S]*?grokFreshSessionForSandbox[\s\S]*?openCodeFreshSessionForCompatibility[\s\S]*?let hermesPreviousResponseId = freshNativeSessionRequired\s*\?\s*null/,
  "Hermes previous_response_id is cleared for every transition that requires a fresh native session",
);
assert.match(
  route,
  /conv\.inferenceRouteId = inferencePlan\.route\.id;[\s\S]*?conv\.inferenceRouteFingerprint = inferencePlan\.fingerprint;/,
  "successful generic launches persist the route identity and fingerprint",
);

console.log("inference-route-routing.test.ts: ok");
