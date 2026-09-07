// Source-contract pins for attestation conveyance (cave-01v4u).
//
// These pins read the source files that choose attestation conveyance and
// enforce the literals: the client must request "direct" (never "none"), and
// the verifier must refuse "none" for new remote registrations. A behavior
// test could drift from the code that ships; these pins cannot.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("the client requests attestation 'direct' and never 'none'", () => {
  const source = readFileSync(path.join(root, "src/lib/passkey-client.ts"), "utf8");
  assert.match(source, /attestation: "direct"/, "registration must request the attestation statement");
  assert.doesNotMatch(source, /attestation: "none"/, "the client must never fall back to no attestation");
});

test("the verifier refuses fmt 'none' by default", () => {
  const source = readFileSync(path.join(root, "src/lib/server/webauthn-verify.ts"), "utf8");
  assert.match(
    source,
    /if \(input\.format === "none"\) \{[\s\S]*?if \(!input\.allowNone\) \{[\s\S]*?throw new WebAuthnError\([\s\S]*?"attestation"/,
    "fmt 'none' must be a rejection branch unless the loopback policy allows it",
  );
});
