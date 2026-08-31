// @ts-nocheck
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BUILTIN_OPENCLAW_TOOL_PROFILES,
  openClawDiscoveryFromHello,
  openClawSchemaBundlePayloadHash,
  openClawSchemaBundleSigningPayload,
  selectOpenClawToolProfile,
  validateOpenClawToolProfiles,
  type OpenClawSchemaBundle,
  type OpenClawToolProfile,
} from "./openclaw-compatibility.ts";
import {
  OpenClawRegistryBundleLedger,
  adoptOpenClawRegistryProfileBundle,
} from "./openclaw-registry-bundle.ts";
import { negotiateOpenClawBridgeTurn, OpenClawBridgeNegotiationLedger } from "./openclaw-bridge.ts";

// Fixture-driven only: OpenClaw is not installed on this host and no test
// performs a live OpenClaw call, any network access, or stdout parsing. The
// registry trust keys below are throwaway ed25519 fixture keys (Node crypto).

const NOW = Date.parse("2026-08-24T00:00:00.000Z");
const gatewayBeta5Hello = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const negotiationVersionFixtures = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/bridge-negotiation-versions.json", import.meta.url), "utf8"),
);
const beta5Discovery = openClawDiscoveryFromHello(gatewayBeta5Hello);
const concurrentDiscovery = negotiationVersionFixtures.discoveries.concurrentVersion;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fixtureKeyring = { fixture: publicKeyPem };

// A second, unrelated fixture key: material signed by it must never verify
// against the trusting keyring above.
const attacker = generateKeyPairSync("ed25519");
const attackerPrivateKeyPem = attacker.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const beta5Profile = selectOpenClawToolProfile(BUILTIN_OPENCLAW_TOOL_PROFILES, beta5Discovery);
assert.ok(beta5Profile, "the pinned beta5 fixture selects the built-in profile");

// A registry-style refresh carrying a second simultaneously-supported schema
// version, exactly like the slice-1 negotiation conformance set models.
const concurrentProfile = {
  ...structuredClone(beta5Profile),
  id: "openclaw-agent-tool-v2",
  priority: 90,
  requires: {
    ...structuredClone(beta5Profile.requires),
    serverVersions: [concurrentDiscovery.serverVersion],
    agentEventSchemaHash: concurrentDiscovery.agentEventSchemaHash,
  },
  source: { ...beta5Profile.source, blobSha: "b".repeat(40) },
};

function unsignedBundle(overrides = {}) {
  return {
    format: 1,
    runtime: "openclaw",
    sequence: 2,
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    keyId: "fixture",
    profiles: [structuredClone(concurrentProfile)],
    ...overrides,
  };
}

function signBundle(bundle, signingKey = privateKeyPem, keyId = "fixture") {
  const unsigned = { ...bundle, ...(keyId === undefined ? {} : { keyId }) };
  const signature = sign(
    null,
    Buffer.from(openClawSchemaBundleSigningPayload(unsigned), "utf8"),
    signingKey,
  );
  return { ...unsigned, signature: { algorithm: "ed25519", value: signature.toString("base64") } };
}

// ── Adoption happy path ──────────────────────────────────────────────────────
const ledger = new OpenClawRegistryBundleLedger();
const signedBundle = signBundle(unsignedBundle());
const adopted = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-adopt",
  bundle: signedBundle,
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger,
});
assert.equal(adopted.outcome, "adopted", "a correctly signed bundle is adopted");
assert.equal(adopted.diagnostic, null);
assert.equal(adopted.validated.verifiedKeyId, "fixture");
assert.equal(adopted.validated.source, "inline");
assert.equal(adopted.validated.sequence, 2);
assert.equal(adopted.validated.payloadHash, openClawSchemaBundlePayloadHash(signedBundle));
assert.deepEqual(
  adopted.validated.profiles.map((profile) => profile.id).sort(),
  ["openclaw-agent-tool-v1", "openclaw-agent-tool-v2"],
  "an adopted bundle contributes its profiles alongside the non-retired built-ins",
);
assert.ok(
  validateOpenClawToolProfiles(adopted.validated.profiles),
  "the adopted combined profile set is itself a validated profile set",
);
assert.deepEqual(
  ledger.lastValidated("conv-adopt"),
  adopted.validated,
  "an adopted bundle is remembered as the conversation's last validated set",
);

// A bundle may also retire a built-in profile explicitly.
const retiringBundle = signBundle(unsignedBundle({
  sequence: 3,
  retiredProfileIds: ["openclaw-agent-tool-v1"],
}));
const retiringAdoption = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-retire",
  bundle: retiringBundle,
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger,
});
assert.equal(retiringAdoption.outcome, "adopted");
assert.deepEqual(
  retiringAdoption.validated.profiles.map((profile) => profile.id),
  ["openclaw-agent-tool-v2"],
  "a retired built-in profile leaves the adopted set",
);

// Re-adoption of the identical bundle is idempotent (equal sequence + payload).
const readopted = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-adopt",
  bundle: signedBundle,
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger,
});
assert.equal(readopted.outcome, "adopted", "an unchanged validated bundle re-adopts");

// ── Cache-hit validation: a cached bundle is used only when it still validates ──
const cacheAdoption = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-cache",
  bundle: signBundle(unsignedBundle()),
  source: "cache",
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: new OpenClawRegistryBundleLedger(),
});
assert.equal(cacheAdoption.outcome, "adopted");
assert.equal(cacheAdoption.validated.source, "cache", "a cache hit that still validates is used as cached");

const tamperedCache = signBundle(unsignedBundle());
tamperedCache.profiles = structuredClone(tamperedCache.profiles);
tamperedCache.profiles[0].priority = 1; // payload mutated after signing
const tamperedCacheAdoption = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-cache",
  bundle: tamperedCache,
  source: "cache",
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: new OpenClawRegistryBundleLedger(),
});
assert.equal(
  tamperedCacheAdoption.outcome,
  "retained",
  "a mutated cache record is never adopted",
);
assert.equal(tamperedCacheAdoption.diagnostic, "registry-bundle-signature-unverified");

// ── Rejection modes ──────────────────────────────────────────────────────────
function assertRetained(adoption, diagnostic, label) {
  assert.equal(adoption.outcome, "retained", `${label}: the candidate is retained, not adopted`);
  assert.equal(adoption.diagnostic, diagnostic, `${label}: the rejection names its diagnostic`);
  assert.deepEqual(
    adoption.profiles.map((profile) => profile.id).sort(),
    ["openclaw-agent-tool-v1"],
    `${label}: the conversation retains the built-in profile set`,
  );
}

assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-absent",
    bundle: undefined,
    publicKeys: fixtureKeyring,
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-absent",
  "no candidate bundle",
);

assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-unsigned",
    bundle: unsignedBundle(),
    publicKeys: fixtureKeyring,
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-signature-unverified",
  "an unsigned bundle",
);

assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-wrongkey",
    bundle: signBundle(unsignedBundle(), attackerPrivateKeyPem, "other"),
    publicKeys: { other: publicKeyPem },
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-signature-unverified",
  "a bundle signed by a key outside the keyring",
);

assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-nokeys",
    bundle: signedBundle,
    publicKeys: undefined,
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-signature-unverified",
  "an empty keyring trusts nothing",
);

const expiredBundle = signBundle(unsignedBundle({
  issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
}));
assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-expired",
    bundle: expiredBundle,
    publicKeys: fixtureKeyring,
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-expired",
  "an expired bundle",
);

assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-malformed",
    bundle: { ...unsignedBundle(), profiles: "not-a-list" },
    publicKeys: fixtureKeyring,
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-invalid",
  "a structurally malformed bundle",
);

assertRetained(
  adoptOpenClawRegistryProfileBundle({
    conversationId: "conv-duplicate",
    bundle: signBundle(unsignedBundle({
      profiles: [structuredClone(concurrentProfile), structuredClone(concurrentProfile)],
    })),
    publicKeys: fixtureKeyring,
    now: NOW,
    ledger: new OpenClawRegistryBundleLedger(),
  }),
  "registry-bundle-invalid",
  "a bundle whose profile set does not validate",
);

// ── Rollback protection: a failing candidate never replaces the validated set ──
const rollbackLedger = new OpenClawRegistryBundleLedger();
const seq3Bundle = signBundle(unsignedBundle({
  sequence: 3,
  profiles: [{ ...structuredClone(concurrentProfile), priority: 80 }],
}));
const seq3Adoption = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-rollback",
  bundle: seq3Bundle,
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: rollbackLedger,
});
assert.equal(seq3Adoption.outcome, "adopted", "the newer bundle is adopted first");

const seq2Rollback = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-rollback",
  bundle: signedBundle,
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: rollbackLedger,
});
assert.equal(seq2Rollback.outcome, "retained");
assert.equal(
  seq2Rollback.diagnostic,
  "registry-bundle-rollback",
  "an older validated bundle is a rollback",
);
assert.deepEqual(
  rollbackLedger.lastValidated("conv-rollback").sequence,
  3,
  "a rejected rollback never replaces the last validated set",
);

const seq3Rewrite = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-rollback",
  bundle: signBundle(unsignedBundle({
    sequence: 3,
    profiles: [{ ...structuredClone(concurrentProfile), priority: 70 }],
  })),
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: rollbackLedger,
});
assert.equal(
  seq3Rewrite.diagnostic,
  "registry-bundle-rollback",
  "the same sequence with a different payload is a rewrite, never an adoption",
);
assert.deepEqual(
  rollbackLedger.lastValidated("conv-rollback").payloadHash,
  openClawSchemaBundlePayloadHash(seq3Bundle),
  "the rewritten candidate never replaces the validated payload",
);
assert.deepEqual(
  seq2Rollback.profiles.map((profile) => profile.id).sort(),
  ["openclaw-agent-tool-v1", "openclaw-agent-tool-v2"],
  "after a rejected candidate the conversation still negotiates against its validated set",
);

// A checkpoint pins the minimum trusted sequence/payload.
const checkpointAdoption = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-checkpoint",
  bundle: seq3Bundle,
  publicKeys: fixtureKeyring,
  checkpoint: { sequence: 5, payloadHash: "a".repeat(64) },
  now: NOW,
  ledger: new OpenClawRegistryBundleLedger(),
});
assert.equal(
  checkpointAdoption.diagnostic,
  "registry-bundle-rollback",
  "a bundle behind a published checkpoint is a rollback",
);

// ── Concurrent schema versions across conversations ──────────────────────────
const concurrentLedger = new OpenClawRegistryBundleLedger();
const convA = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-a",
  bundle: signBundle(unsignedBundle({ keyId: undefined })),
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: concurrentLedger,
});
assert.equal(convA.outcome, "adopted", "a single-key keyring verifies a bundle without keyId");
assert.equal(convA.validated.verifiedKeyId, "fixture");
const convB = adoptOpenClawRegistryProfileBundle({
  conversationId: "conv-b",
  bundle: seq3Bundle,
  publicKeys: fixtureKeyring,
  now: NOW,
  ledger: concurrentLedger,
});
assert.equal(convB.outcome, "adopted");
assert.notEqual(
  convA.validated.payloadHash,
  convB.validated.payloadHash,
  "concurrent conversations hold distinct validated bundles",
);
assert.deepEqual(concurrentLedger.lastValidated("conv-a"), convA.validated);
assert.deepEqual(concurrentLedger.lastValidated("conv-b"), convB.validated);

// ── Turn negotiation composition (adoption → per-conversation negotiation) ──
const turnRegistryLedger = new OpenClawRegistryBundleLedger();
const turnNegotiationLedger = new OpenClawBridgeNegotiationLedger();
const registryInput = {
  registryBundle: signedBundle,
  registryPublicKeys: fixtureKeyring,
  registryLedger: turnRegistryLedger,
  now: NOW,
};

const beta5Turn = negotiateOpenClawBridgeTurn({
  conversationId: "conv-turn",
  discovery: beta5Discovery,
  ...registryInput,
  ledger: turnNegotiationLedger,
});
assert.equal(
  beta5Turn.negotiation.outcome,
  "structured",
  "the pinned beta5 gateway negotiates structured under the adopted set",
);
assert.equal(beta5Turn.negotiation.profileId, "openclaw-agent-tool-v1");
assert.equal(beta5Turn.capabilities.toolEvents, true);
assert.equal(beta5Turn.diagnostic, null);

const concurrentTurn = negotiateOpenClawBridgeTurn({
  conversationId: "conv-turn",
  discovery: concurrentDiscovery,
  ...registryInput,
  ledger: turnNegotiationLedger,
});
assert.equal(
  concurrentTurn.negotiation.outcome,
  "structured",
  "the refreshed schema version negotiates structured through the adopted bundle",
);
assert.equal(concurrentTurn.negotiation.profileId, "openclaw-agent-tool-v2");
assert.notEqual(beta5Turn.negotiation.schemaHash, concurrentTurn.negotiation.schemaHash);

const withoutBundleTurn = negotiateOpenClawBridgeTurn({
  conversationId: "conv-unbundled",
  discovery: concurrentDiscovery,
  ledger: turnNegotiationLedger,
});
assert.equal(
  withoutBundleTurn.negotiation.outcome,
  "degraded",
  "without an adopted bundle the refreshed version has no validated profile",
);
assert.equal(withoutBundleTurn.negotiation.diagnostic, "unsupported-gateway-version");
assert.match(
  withoutBundleTurn.diagnostic,
  /gateway version 2026\.8\.0 has no validated compatibility profile; plain chat is retained\./,
  "the degraded turn's diagnostic is visible and value-free",
);

// A rejected candidate never replaces the conversation's validated set: after
// the successful adoption above, a tampered refresh still negotiates against
// the previously validated set.
const rejectedTurn = negotiateOpenClawBridgeTurn({
  conversationId: "conv-turn",
  discovery: concurrentDiscovery,
  registryBundle: tamperedCache,
  registryPublicKeys: fixtureKeyring,
  registryLedger: turnRegistryLedger,
  now: NOW,
  ledger: turnNegotiationLedger,
});
assert.equal(
  rejectedTurn.negotiation.outcome,
  "structured",
  "rollback protection keeps the validated set in effect for the turn",
);
assert.equal(rejectedTurn.negotiation.profileId, "openclaw-agent-tool-v2");

const malformedTurn = negotiateOpenClawBridgeTurn({
  conversationId: "conv-turn",
  discovery: { not: "a discovery record" },
  ...registryInput,
  ledger: turnNegotiationLedger,
});
assert.equal(malformedTurn.negotiation.outcome, "degraded");
assert.equal(
  malformedTurn.negotiation.diagnostic,
  "gateway-discovery-unavailable",
  "a malformed discovered record degrades the turn",
);

console.log("openclaw-registry-bundle.test.ts: ok");
