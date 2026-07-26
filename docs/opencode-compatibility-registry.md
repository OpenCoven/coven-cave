# OpenCode compatibility registry

Coven Cave can update OpenCode JSON event schemas independently of an app release only when its packaged build includes a trusted registry configuration. The registry publishes signed, versioned JSON bundles; Cave embeds the corresponding Ed25519 **public** key and accepts a bundle only after signature, expiry, schema, and monotonic-sequence validation.

## Release configuration

Every desktop release must provide these GitHub Actions secrets:

- `OPENCODE_SCHEMA_REGISTRY_URL` — canonical HTTPS URL for the signed OpenCode bundle.
- `OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY` — PEM-encoded Ed25519 public key that verifies that bundle.

- `OPENCODE_SCHEMA_REGISTRY_CHECKPOINT` â€” compact JSON with the current bundle's `sequence` and lowercase SHA-256 `payloadHash` of its canonical unsigned payload.

For a rotation release, replace the single-key secret with `OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS`: a JSON object of one to four `{ "key-id": "PEM" }` entries containing the active key and the retiring key. The release workflow maps this to `NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEYS`; it is an alternative to the single-key setting, not an additional trust source.

The release workflow maps these values to `NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL`, `NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY`, and `NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_CHECKPOINT`, then runs `scripts/check-opencode-registry-release.mjs` before packaging. They are public verification material, intentionally compiled into the desktop application. A release fails closed if a value is missing, the URL is non-HTTPS or contains credentials, the key is not Ed25519, or the checkpoint is malformed.

Development and test processes may inject `COVEN_OPENCODE_SCHEMA_REGISTRY_URL` and `COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY` instead. Without a configured registry, the source-trusted built-in profile is the offline/development baseline; it does not provide independently deployed schema recovery and must not be used to ship a desktop release.

## Publishing and rotation

The registry publisher owns the private signing key; it must never be placed in Cave, the release workflow, logs, or issue text. Publish an immutable bundle for each increasing `sequence`, with canonical RFC 3339 UTC timestamps and the detached Ed25519 signature over the bundle payload. Cave rejects rewrites at an existing sequence and lower sequences even after a cache entry expires. Before every Cave release, set the checkpoint to the current signed bundle. On a cache-reset client, Cave rejects a lower sequence and a different payload at the checkpoint sequence, so an old CDN response cannot become the initial trusted parser.

## Signature canonicalization (format 1)

Format 1 signs the UTF-8 bytes of the unsigned bundle: remove the top-level `signature` member, then serialize recursively with no whitespace. Arrays retain their original order. Object member names are sorted lexicographically by ECMAScript UTF-16 code-unit order. Strings and primitive values use ECMAScript `JSON.stringify` escaping; object separators are `,` and `:`, with no trailing newline. No transport encoding or pretty-printing is signed. The detached Ed25519 signature is standard base64 over exactly those bytes.

This representation is frozen for format 1. A changed canonicalization algorithm, signed-member set, or escaping rule requires a new bundle format and an explicit verifier; publishers must not silently reinterpret format 1.

The following byte-level vector is used by Cave's conformance test and should be reproduced by non-Node registry publishers before deployment:

```text
input unsigned value: { "z":"last", "runtime":"opencode", "number":0, "nested":{ "unicode":"é", "quote":"\\\"", "line":"a\nb" }, "array":[true,2,null] }
canonical UTF-8 text: {"array":[true,2,null],"nested":{"line":"a\\nb","quote":"\\\"","unicode":"é"},"number":0,"runtime":"opencode","z":"last"}
```

To rotate a key, publish a Cave release carrying an active-plus-previous keyring before publishing bundles signed only by the new key. New bundles include the signed `keyId`; Cave stores that verified signer alongside its cache, so an offline client can continue using a valid prior-key bundle during the overlap. Keep the prior key in the packaged keyring for one release window (and no more than the bundle expiry), then remove it in a later release after the registry has served the new key successfully. Emergency revocation removes the compromised key in a new release and intentionally falls back to the bundled parser for any cache that only it signed. Record the registry endpoint, public-key fingerprint, owner, rotation date, and retirement date in the release checklist.
