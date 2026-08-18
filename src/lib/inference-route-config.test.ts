// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(process.cwd(), ".inference-route-config-test-"));
process.env.HOME = tempHome;

try {
  const config = await import("./cave-config.ts");

  const initial = await config.loadConfig();
  assert.deepEqual(initial.inferenceRoutes, {});

  const saved = await config.saveConfig({
    inferenceRoutes: {
      "copilot-anthropic": {
        id: "copilot-anthropic",
        label: "Copilot Anthropic",
        harness: "copilot-cli",
        provider: "anthropic",
        protocol: "anthropic-messages",
        supportTier: "native-byok",
        endpoint: "https://api.anthropic.com/",
        credentialRef: "vault:copilot-anthropic",
        enabled: true,
        apiKey: "must-not-persist",
      },
    },
    familiars: {
      sage: {
        harness: "copilot",
        inferenceRouteId: "copilot-anthropic",
      },
      cody: {
        harness: "codex",
        inferenceRouteId: "native:codex",
      },
    },
  });

  assert.deepEqual(saved.inferenceRoutes, {
    "copilot-anthropic": {
      id: "copilot-anthropic",
      label: "Copilot Anthropic",
      harness: "copilot",
      provider: "anthropic",
      protocol: "anthropic-messages",
      supportTier: "native-byok",
      endpoint: "https://api.anthropic.com",
      credentialRef: "vault:copilot-anthropic",
      enabled: true,
    },
  });
  assert.equal(config.bindingFor(saved, "sage").inferenceRouteId, "copilot-anthropic");
  assert.deepEqual(
    {
      inferenceRouteId: config.bindingFor(saved, "cody").inferenceRouteId,
      hasInvalidInferenceRouteBinding:
        config.bindingFor(saved, "cody").hasInvalidInferenceRouteBinding,
    },
    {
      inferenceRouteId: "native:codex",
      hasInvalidInferenceRouteBinding: undefined,
    },
    "an explicitly persisted native route remains a valid implicit route",
  );
  assert.equal(
    config.bindingFor(saved, "unconfigured").inferenceRouteId,
    "native:codex",
    "legacy bindings derive the native route without a config rewrite",
  );

  await assert.rejects(
    config.saveConfig({
      inferenceRoutes: {
        unsafe: {
          id: "unsafe",
          label: "Unsafe",
          harness: "codex",
          provider: "anthropic",
          protocol: "openai-responses",
          supportTier: "compatible-gateway",
          endpoint: "http://example.com/v1",
          enabled: true,
        },
      },
    }),
    /Invalid inference route/,
  );
} finally {
  process.env.HOME = previousHome;
  await rm(tempHome, { recursive: true, force: true });
}

console.log("inference-route-config.test.ts: ok");
