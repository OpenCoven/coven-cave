// Pinned-root integrity tests (cave-01v4u).
//
// These tests exist so a wrong, corrupted, or silently rotated root embed
// fails CI instead of silently weakening attestation verification: the Apple
// root must parse as a CA certificate, match Apple's published SHA-256
// fingerprint, and the production packed root set must stay empty (fail
// closed) until a specific vendor root is deliberately reviewed and pinned.

import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { test } from "node:test";

import {
  APPLE_WEB_AUTHN_ROOT_G1,
  APPLE_WEB_AUTHN_ROOTS,
  PACKED_WEB_AUTHN_ROOTS,
} from "./webauthn-roots.ts";

test("the embedded Apple WebAuthn root parses and matches Apple's published fingerprint", () => {
  const cert = new X509Certificate(APPLE_WEB_AUTHN_ROOT_G1.der);
  assert.equal(cert.subject, "CN=Apple WebAuthn Root CA\nO=Apple Inc.\nST=California");
  assert.equal(cert.ca, true, "the pinned Apple root is a CA");
  assert.equal(
    cert.fingerprint256.replace(/:/g, "").toLowerCase(),
    APPLE_WEB_AUTHN_ROOT_G1.fingerprint256,
    "the embedded DER must hash to the fingerprint published by Apple",
  );
  assert.equal(
    APPLE_WEB_AUTHN_ROOT_G1.fingerprint256,
    "0915dd5c07a28db549d1f677bb5a75d4bfbe9561a773424327762e9e02f9bb29",
    "the pinned fingerprint literal must be Apple's published value",
  );
});

test("the production packed root set is empty until a vendor root is deliberately reviewed", () => {
  assert.equal(PACKED_WEB_AUTHN_ROOTS.length, 0, "x5c packed attestation stays fail-closed by default");
  assert.equal(APPLE_WEB_AUTHN_ROOTS.length, 1);
  assert.equal(APPLE_WEB_AUTHN_ROOTS[0].id, APPLE_WEB_AUTHN_ROOT_G1.id);
});
