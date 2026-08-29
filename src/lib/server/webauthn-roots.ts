// Pinned WebAuthn attestation trust anchors (cave-01v4u).
//
// Attestation verification only ever trusts a certificate chain that ends at
// one of the roots pinned HERE, by exact DER equality — never by self-signature
// or by "the client sent it". A rotated or unknown root therefore fails closed:
// new enrollments are refused, never silently accepted.
//
// The Apple WebAuthn Root CA (G1) is the dedicated trust anchor for Apple
// Anonymous Attestation (fmt "apple"), distinct from Apple's general-purpose
// roots. Distributed at:
//   https://www.apple.com/certificateauthority/Apple_WebAuthn_Root_CA.pem
// Fingerprint and DER are pinned by tests so a wrong or corrupted embed fails
// CI instead of silently weakening verification.
//
// The `packed` root set is deliberately EMPTY: there is no universal WebAuthn
// root for fmt "packed", and chaining to an arbitrary vendor root would prove
// a vendor, not the Secure Enclave. Packed attestation with x5c is therefore
// refused until a specific vendor root is deliberately reviewed and pinned
// here as an additive entry.

export type PinnedRoot = {
  /** Stable identifier for diagnostics and future rotation. */
  id: string;
  /** DER-encoded X.509 certificate; exact equality is the trust anchor. */
  der: Buffer;
  /** SHA-256 fingerprint of `der`, lowercased hex, pinned by test. */
  fingerprint256: string;
};

// DER (base64) of the Apple WebAuthn Root CA (G1) certificate, fetched from
// Apple's certificate authority page. Do not hand-edit: regen with
//   curl -sL https://www.apple.com/certificateauthority/Apple_WebAuthn_Root_CA.pem \
//     | openssl x509 -outform DER | base64 -w0
const APPLE_WEB_AUTHN_ROOT_G1_DER_B64 = (
  "MIICEjCCAZmgAwIBAgIQaB0BbHo84wIlpQGUKEdXcTAKBggqhkjOPQQDAzBLMR8w" +
  "HQYDVQQDDBZBcHBsZSBXZWJBdXRobiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJ" +
  "bmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMB4XDTIwMDMxODE4MjEzMloXDTQ1MDMx" +
  "NTAwMDAwMFowSzEfMB0GA1UEAwwWQXBwbGUgV2ViQXV0aG4gUm9vdCBDQTETMBEG" +
  "A1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTB2MBAGByqGSM49" +
  "AgEGBSuBBAAiA2IABCJCQ2pTVhzjl4Wo6IhHtMSAzO2cv+H9DQKev3//fG59G11k" +
  "xu9eI0/7o6V5uShBpe1u6l6mS19S1FEh6yGljnZAJ+2GNP1mi/YK2kSXIuTHjxA/" +
  "pcoRf7XkOtO4o1qlcaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUJtdk" +
  "2cV4wlpn0afeaxLQG2PxxtcwDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2cA" +
  "MGQCMFrZ+9DsJ1PW9hfNdBywZDsWDbWFp28it1d/5w2RPkRX3Bbn/UbDTNLx7Jr3" +
  "jAGGiQIwHFj+dJZYUJR786osByBelJYsVZd2GbHQu209b5RCmGQ21gpSAk9QZW4B" +
  "1bWeT0vT"
);

export const APPLE_WEB_AUTHN_ROOT_G1: PinnedRoot = {
  id: "apple-webauthn-root-g1",
  der: Buffer.from(APPLE_WEB_AUTHN_ROOT_G1_DER_B64, "base64"),
  fingerprint256: "0915dd5c07a28db549d1f677bb5a75d4bfbe9561a773424327762e9e02f9bb29",
};

/** Production trust anchors for Apple Anonymous Attestation. */
export const APPLE_WEB_AUTHN_ROOTS: readonly PinnedRoot[] = [APPLE_WEB_AUTHN_ROOT_G1];

/** Production trust anchors for fmt "packed" with x5c. Deliberately empty —
 *  see the module header. */
export const PACKED_WEB_AUTHN_ROOTS: readonly PinnedRoot[] = [];
