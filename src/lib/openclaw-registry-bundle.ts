import {
  BUILTIN_OPENCLAW_SCHEMA_BUNDLE,
  BUILTIN_OPENCLAW_TOOL_PROFILES,
  isOpenClawSchemaBundle,
  openClawSchemaBundlePayloadHash,
  openClawSchemaBundleSigningPayload,
  validateOpenClawToolProfiles,
  verifyOpenClawSchemaBundle,
  type OpenClawRegistryCheckpoint,
  type OpenClawRegistryKeyring,
  type OpenClawSchemaBundle,
  type OpenClawToolProfile,
} from "./openclaw-compatibility.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Registry bundle adoption (issue #4892 slice 2).
//
// A compatibility profile bundle is how a validated schema-version refresh
// reaches conversations without a Cave release. This module is the adoption
// seam between a candidate bundle — freshly delivered, or read from an
// offline cache by the caller — and the per-conversation bridge negotiation.
// It is pure: no network, no filesystem, no live OpenClaw calls. Signature and
// trust verification run through `verifyOpenClawSchemaBundle` (Node crypto,
// ed25519; fixture keys are fine for tests).
//
// Fail-closed properties, each fixture-tested:
//   - an unsigned, tampered, malformed, or expired bundle is never adopted;
//   - a bundle that fails validation never replaces the last validated set
//     (rollback protection, per conversation);
//   - a cache hit is used only when it still validates;
//   - distinct conversations may hold distinct validated schema versions
//     concurrently (the ledger is keyed by conversation).
// ─────────────────────────────────────────────────────────────────────────────

export type OpenClawRegistryBundleSource = "inline" | "cache";

/** The validated set a conversation negotiates against after an adoption. */
export type OpenClawValidatedRegistryBundle = {
  /** Bundle profiles plus every non-retired built-in profile. */
  profiles: OpenClawToolProfile[];
  bundleProfiles: OpenClawToolProfile[];
  verifiedKeyId: string;
  sequence: number;
  payloadHash: string;
  source: OpenClawRegistryBundleSource;
};

export type OpenClawRegistryBundleDiagnostic =
  | "registry-bundle-absent"
  | "registry-bundle-invalid"
  | "registry-bundle-signature-unverified"
  | "registry-bundle-expired"
  | "registry-bundle-rollback";

export type OpenClawRegistryBundleAdoption =
  | {
      outcome: "adopted";
      validated: OpenClawValidatedRegistryBundle;
      diagnostic: null;
    }
  | {
      /**
       * Nothing was adopted: no candidate was provided ("absent") or the
       * candidate failed validation. The conversation retains its last
       * validated set, or the built-in profile when it has none — a rejected
       * bundle never replaces the last validated set.
       */
      outcome: "retained";
      profiles: OpenClawToolProfile[];
      diagnostic: OpenClawRegistryBundleDiagnostic;
      sequence: number | null;
      payloadHash: string | null;
    };

const OPENCLAW_REGISTRY_BUNDLE_LEDGER_LIMIT = 128;

function builtInOpenClawProfiles(): OpenClawToolProfile[] {
  return validateOpenClawToolProfiles(BUILTIN_OPENCLAW_TOOL_PROFILES) ?? [];
}

function meetsOpenClawGenesisFloor(bundle: OpenClawSchemaBundle): boolean {
  return bundle.sequence > BUILTIN_OPENCLAW_SCHEMA_BUNDLE.sequence
    || (
      bundle.sequence === BUILTIN_OPENCLAW_SCHEMA_BUNDLE.sequence
      && openClawSchemaBundleSigningPayload(bundle)
        === openClawSchemaBundleSigningPayload(BUILTIN_OPENCLAW_SCHEMA_BUNDLE)
    );
}

/** Bundle profiles plus every built-in profile the bundle has not retired. */
function combinedOpenClawRegistryProfiles(bundle: OpenClawSchemaBundle): OpenClawToolProfile[] | null {
  const bundleProfiles = validateOpenClawToolProfiles(bundle.profiles);
  if (!bundleProfiles) return null;
  const retiredProfileIds = new Set(bundle.retiredProfileIds ?? []);
  return validateOpenClawToolProfiles([
    ...bundleProfiles,
    ...builtInOpenClawProfiles().filter((profile) => !retiredProfileIds.has(profile.id)),
  ]);
}

/**
 * Per-conversation record of the last validated registry bundle. Only adopted
 * bundles are ever remembered, and an entry that would move backwards (an
 * older sequence, or the same sequence with a different payload) never
 * replaces the recorded one — so a failing candidate can never roll a
 * conversation's validated set back.
 */
export class OpenClawRegistryBundleLedger {
  readonly #limit: number;
  readonly #validated = new Map<string, OpenClawValidatedRegistryBundle>();

  constructor(limit = OPENCLAW_REGISTRY_BUNDLE_LEDGER_LIMIT) {
    this.#limit = limit;
  }

  lastValidated(conversationId: string): OpenClawValidatedRegistryBundle | null {
    return this.#validated.get(conversationId) ?? null;
  }

  rememberValidated(conversationId: string, validated: OpenClawValidatedRegistryBundle): void {
    if (typeof conversationId !== "string" || conversationId.length === 0) return;
    const prior = this.#validated.get(conversationId);
    if (
      prior
      && (
        prior.sequence > validated.sequence
        || (prior.sequence === validated.sequence && prior.payloadHash !== validated.payloadHash)
      )
    ) return;
    this.#validated.delete(conversationId);
    this.#validated.set(conversationId, validated);
    while (this.#validated.size > this.#limit) {
      const oldest = this.#validated.keys().next();
      if (oldest.done) break;
      this.#validated.delete(oldest.value);
    }
  }
}

/**
 * Verify a candidate registry profile bundle and, when it is trustworthy,
 * adopt its combined profile set for one conversation. The candidate may be
 * freshly delivered ("inline") or an offline-cached bundle read by the caller
 * ("cache") — a cache hit is used only when it still validates against the
 * keyring, the expiry window, the checkpoint, and the conversation's last
 * validated set. Everything else is rejected with a value-free diagnostic and
 * the conversation retains its last validated set (or the built-in profile).
 */
export function adoptOpenClawRegistryProfileBundle(input: {
  conversationId: string;
  /** Raw candidate bundle; never trusted before verification. */
  bundle: unknown;
  source?: OpenClawRegistryBundleSource;
  /** Trust anchors for the ed25519 signature check (fixture keys are fine). */
  publicKeys?: OpenClawRegistryKeyring;
  checkpoint?: OpenClawRegistryCheckpoint;
  now?: number;
  ledger?: OpenClawRegistryBundleLedger;
}): OpenClawRegistryBundleAdoption {
  const now = input.now ?? Date.now();
  const retained = (
    diagnostic: OpenClawRegistryBundleDiagnostic,
    bundle: unknown,
  ): OpenClawRegistryBundleAdoption => ({
    outcome: "retained",
    profiles: input.ledger?.lastValidated(input.conversationId)?.profiles ?? builtInOpenClawProfiles(),
    diagnostic,
    sequence: typeof (bundle as OpenClawSchemaBundle | null | undefined)?.sequence === "number"
      && Number.isSafeInteger((bundle as OpenClawSchemaBundle).sequence)
      ? (bundle as OpenClawSchemaBundle).sequence
      : null,
    payloadHash: typeof bundle === "object" && bundle !== null
      && typeof (bundle as OpenClawSchemaBundle).profiles !== "undefined"
      ? safeOpenClawBundlePayloadHash(bundle)
      : null,
  });

  if (input.bundle === undefined || input.bundle === null) {
    return retained("registry-bundle-absent", null);
  }
  // Structural + schema validation first (expiry tolerated) so each failure
  // mode can report its own diagnostic instead of one opaque rejection.
  if (!isOpenClawSchemaBundle(input.bundle, now, { allowExpired: true })) {
    return retained("registry-bundle-invalid", input.bundle);
  }
  const bundle = input.bundle as OpenClawSchemaBundle;
  const verifiedKeyId = verifiedOpenClawRegistryBundleKeyId(bundle, input.publicKeys, now);
  if (verifiedKeyId === null) {
    return retained("registry-bundle-signature-unverified", bundle);
  }
  if (!isOpenClawSchemaBundle(bundle, now)) {
    return retained("registry-bundle-expired", bundle);
  }
  if (!meetsOpenClawGenesisFloor(bundle)) {
    return retained("registry-bundle-rollback", bundle);
  }
  if (input.checkpoint) {
    if (
      bundle.sequence < input.checkpoint.sequence
      || (
        bundle.sequence === input.checkpoint.sequence
        && openClawSchemaBundlePayloadHash(bundle) !== input.checkpoint.payloadHash
      )
    ) {
      return retained("registry-bundle-rollback", bundle);
    }
  }
  const lastValidated = input.ledger?.lastValidated(input.conversationId) ?? null;
  if (
    lastValidated
    && (
      bundle.sequence < lastValidated.sequence
      || (bundle.sequence === lastValidated.sequence && openClawSchemaBundlePayloadHash(bundle) !== lastValidated.payloadHash)
    )
  ) {
    return retained("registry-bundle-rollback", bundle);
  }
  const profiles = combinedOpenClawRegistryProfiles(bundle);
  if (!profiles) {
    return retained("registry-bundle-invalid", bundle);
  }
  const validated: OpenClawValidatedRegistryBundle = {
    profiles,
    bundleProfiles: validateOpenClawToolProfiles(bundle.profiles) ?? [],
    verifiedKeyId,
    sequence: bundle.sequence,
    payloadHash: openClawSchemaBundlePayloadHash(bundle),
    source: input.source ?? "inline",
  };
  input.ledger?.rememberValidated(input.conversationId, validated);
  return { outcome: "adopted", validated, diagnostic: null };
}

function safeOpenClawBundlePayloadHash(bundle: unknown): string | null {
  try {
    return openClawSchemaBundlePayloadHash(bundle as OpenClawSchemaBundle);
  } catch {
    return null;
  }
}

/**
 * The key id a bundle's signature verified against, mirroring the trust
 * contract of `verifyOpenClawSchemaBundle`: a bundle without `keyId` may only
 * verify against a single-key keyring, and a `keyId` must match exactly one
 * keyring entry.
 */
function verifiedOpenClawRegistryBundleKeyId(
  bundle: OpenClawSchemaBundle,
  publicKeys: OpenClawRegistryKeyring | undefined,
  now: number,
): string | null {
  const keyring = publicKeys ?? {};
  const entries = Object.entries(keyring);
  // Expiry is verified separately below so an expired-but-authentic bundle
  // reports "registry-bundle-expired" rather than an unverified signature.
  if (!verifyOpenClawSchemaBundle(bundle, keyring, now, { allowExpired: true })) return null;
  if (bundle.keyId !== undefined) {
    return entries.some(([id]) => id === bundle.keyId) ? bundle.keyId : null;
  }
  return entries.length === 1 ? entries[0][0] : null;
}
