// Generated throwaway attestation fixture chains for cave-01v4u tests.
// NOT production material: these keys exist only to exercise the verifiers.
// Regenerate with /tmp/attest-fixture/gen.sh (see the cave-01v4u PR notes);
// do not reuse these keys anywhere else.
import { X509Certificate } from "node:crypto";

export const APPLE_FIXTURE_CHALLENGE = "fixture-challenge-0123456789";
export const APPLE_FIXTURE_ORIGIN = "http://127.0.0.1:3080";
export const APPLE_FIXTURE_RP_ID = "127.0.0.1";

/** Deterministic clientDataJSON (hex) for the apple fixture ceremony. */
export const APPLE_FIXTURE_CLIENT_DATA_JSON_HEX = "7b2274797065223a22776562617574686e2e637265617465222c226368616c6c656e6765223a22666978747572652d6368616c6c656e67652d30313233343536373839222c226f726967696e223a22687474703a2f2f3132372e302e302e313a33303830227d";
/** Deterministic authenticator data (hex) including the COSE key whose
 *  private counterpart is apple-leaf. */
export const APPLE_FIXTURE_AUTH_DATA_HEX = "12ca17b49af2289436f303e0166030a21e525d266e209267433801a8fd4071a04500000000000000000000000000000000000000000010ababababababababababababababababa501020326200121582071ce70274e0495358b129b2938b39b519d6e42ab0ccc806c4fce59a6ff1534b2225820973cbfaf0881fa5919ec050287f5b1c002b37c93f348241f435cb8ddaeef7689";
/** SHA256(authData || SHA256(clientDataJSON)) — committed in the leaf cert. */
export const APPLE_FIXTURE_NONCE_HEX = "99c086968586bc85e9eaa68e25694a53e7434e3ae49f130fa408c09143da4d3b";

const APPLE_LEAF_DER_B64 = (
  "MIIB2jCCAYGgAwIBAgIUMQcyLCdr5gKx93LlTqnRHxGVX3gwCgYIKoZIzj0EAwIw" +
  "JzElMCMGA1UEAwwcQ2F2ZSBUZXN0IEFwcGxlIEludGVybWVkaWF0ZTAeFw0yNjA4" +
  "MjgyMTM1MjFaFw0zNjA4MjUyMTM1MjFaMB8xHTAbBgNVBAMMFENhdmUgVGVzdCBB" +
  "cHBsZSBMZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEcc5wJ04ElTWLEpsp" +
  "OLObUZ1uQqsMzIBsT85Zpv8VNLKXPL+vCIH6WRnsBQKH9bHAArN8k/NIJB9DXLjd" +
  "ru92iaOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDAvBgkqhkiG" +
  "92NkCAIEIgQgmcCGloWGvIXp6qaOJWlKU+dDTjrknxMPpAjAkUPaTTswHQYDVR0O" +
  "BBYEFPmArQsTV7LyFlQiZLquTdhKwIl+MB8GA1UdIwQYMBaAFK1bEPGsncYablxG" +
  "AwH4uR0Qz+9nMAoGCCqGSM49BAMCA0cAMEQCIBS9xNvw9L85q4qAepL0jVwY09nK" +
  "6nJ56aCroggrcOpBAiALof/7YufxS2kCqdzPIbja4wkMKvLIIa03b+y9DJ7D5A=="
);
const APPLE_INTER_DER_B64 = (
  "MIIBqzCCAVGgAwIBAgIUV7eNI79dai4qJ4P02hvBxXxFREcwCgYIKoZIzj0EAwIw" +
  "HzEdMBsGA1UEAwwUQ2F2ZSBUZXN0IEFwcGxlIFJvb3QwHhcNMjYwODI4MjEzNTIx" +
  "WhcNMzYwODI1MjEzNTIxWjAnMSUwIwYDVQQDDBxDYXZlIFRlc3QgQXBwbGUgSW50" +
  "ZXJtZWRpYXRlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7a5rpq7QWqgWLI9k" +
  "wOJgCeoR5J1TWyUlyEGlc9Cm3sD/oo4HWK1rWFI5+2OJJG9AnHZtt9NU1fDrNt5w" +
  "cqNZTKNjMGEwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0O" +
  "BBYEFK1bEPGsncYablxGAwH4uR0Qz+9nMB8GA1UdIwQYMBaAFBajkii8NyGD7p9K" +
  "ZeerELPjRXBsMAoGCCqGSM49BAMCA0gAMEUCIQDf84nesC4Z4YpyocSrZpuqC0lt" +
  "N9dGg87Xk0qopbDKZgIgH3c9jSMx2Bgu0OtbpePwdVKCCXPPbZJyNhDaE2ht2vQ="
);
const APPLE_ROOT_DER_B64 = (
  "MIIBozCCAUmgAwIBAgIUTGkblK54/QNzVcWAy9ypYgYXOQcwCgYIKoZIzj0EAwIw" +
  "HzEdMBsGA1UEAwwUQ2F2ZSBUZXN0IEFwcGxlIFJvb3QwHhcNMjYwODI4MjEzNTIx" +
  "WhcNMzYwODI1MjEzNTIxWjAfMR0wGwYDVQQDDBRDYXZlIFRlc3QgQXBwbGUgUm9v" +
  "dDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABAUk2BsKu6mpB+P1ajtZCSwDoze8" +
  "Mrb5cvKL4Mgk3yG6UYwg018q1C8xh13XQElWiqCtONVuhoSouyY74cT941ijYzBh" +
  "MB0GA1UdDgQWBBQWo5IovDchg+6fSmXnqxCz40VwbDAfBgNVHSMEGDAWgBQWo5Io" +
  "vDchg+6fSmXnqxCz40VwbDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIB" +
  "BjAKBggqhkjOPQQDAgNIADBFAiAsKn1sLDkB54FRsjaDPFcKkrA2cLwM4Sl6SuGH" +
  "DXiOWQIhAM+nLqxzarQkdGtByY1abA3VffG5DQcUMpJ3KGyIsiH6"
);
const PACKED_LEAF_DER_B64 = (
  "MIIBozCCAUigAwIBAgIUaFR1Ig2fS1sxvNpv8vjdeN2TAVMwCgYIKoZIzj0EAwIw" +
  "IDEeMBwGA1UEAwwVQ2F2ZSBUZXN0IFBhY2tlZCBSb290MB4XDTI2MDgyODIxMzUy" +
  "MVoXDTM2MDgyNTIxMzUyMVowIDEeMBwGA1UEAwwVQ2F2ZSBUZXN0IFBhY2tlZCBM" +
  "ZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5QdYGi/wED1dO8EFk8bcuSlA" +
  "CoSz2LLyVAGjdUxyDusqTiS+5Ns7ikuNDu9BCUsAM81Yr2JV8hsKKCEM9Dza+6Ng" +
  "MF4wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwHQYDVR0OBBYEFORtexk0" +
  "8uKpjBFRe4fmdzl3xpR+MB8GA1UdIwQYMBaAFE68J2vcITasW86w0WSllTOUwwMR" +
  "MAoGCCqGSM49BAMCA0kAMEYCIQD5qLUDv59btt9aL/pL+5n6OAGpBvKjU+VTQbRf" +
  "P6cqeQIhAIjrmObWcfcRoluJWDAyZyubHctRuGu7Ju0QPCoj3Fms"
);
const PACKED_ROOT_DER_B64 = (
  "MIIBpTCCAUugAwIBAgIUSTnUXnRWOf9HcC7FJOHIQ8cDDwIwCgYIKoZIzj0EAwIw" +
  "IDEeMBwGA1UEAwwVQ2F2ZSBUZXN0IFBhY2tlZCBSb290MB4XDTI2MDgyODIxMzUy" +
  "MVoXDTM2MDgyNTIxMzUyMVowIDEeMBwGA1UEAwwVQ2F2ZSBUZXN0IFBhY2tlZCBS" +
  "b290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2hm9upsZeeF4i3q6eTRXJ93c" +
  "cBMsnDBPlW6DjuIYlq1ZJ5yXPCc9HtlKca+hCqOI3tosPss6oVj1ERXv3VoNTaNj" +
  "MGEwHQYDVR0OBBYEFE68J2vcITasW86w0WSllTOUwwMRMB8GA1UdIwQYMBaAFE68" +
  "J2vcITasW86w0WSllTOUwwMRMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQD" +
  "AgEGMAoGCCqGSM49BAMCA0gAMEUCIAwaSiBSO+akOU86nIB01H4HnKFDQbzjL1kr" +
  "kEYU96R2AiEAhkiMOTGbVxeWoNkiJAXkARsnrlOZIJZalMWIzb2pmDs="
);

export const APPLE_FIXTURE = {
  /** x5c = [credential cert, intermediate] — root excluded, per WebAuthn. */
  x5c: [Buffer.from(APPLE_LEAF_DER_B64, "base64"), Buffer.from(APPLE_INTER_DER_B64, "base64")] as const,
  root: Buffer.from(APPLE_ROOT_DER_B64, "base64"),
  rootFingerprint256: "9b649d15499e9ccb4dcd1143544e61ccbb0db82dff9595b0c120514076996d64",
};

export const PACKED_FIXTURE = {
  /** Attestation certificate for the packed-basic path (attestation key, not the credential key). */
  leaf: Buffer.from(PACKED_LEAF_DER_B64, "base64"),
  root: Buffer.from(PACKED_ROOT_DER_B64, "base64"),
  rootFingerprint256: "805c08b678ab3ad931d10a19947f972ad08c9af193b0417a00a6683199d62281",
  /** The packed attestation signing key (DER, base64). Test-only. */
  leafPrivateKeyDerB64: (
  "MHcCAQEEIAXOpCoW7JwfFmmcDKr6po/BoDZL+lhgcsiq7wUITPLGoAoGCCqGSM49" +
  "AwEHoUQDQgAE5QdYGi/wED1dO8EFk8bcuSlACoSz2LLyVAGjdUxyDusqTiS+5Ns7" +
  "ikuNDu9BCUsAM81Yr2JV8hsKKCEM9Dza+w=="
),
};

/** A certificate chain ending in a root that is NOT pinned anywhere. */
export function fixtureLeafCert(der: Buffer): X509Certificate {
  return new X509Certificate(der);
}
