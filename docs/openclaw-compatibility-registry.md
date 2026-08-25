# OpenClaw compatibility registry

Coven Cave accepts structured OpenClaw tool activity only when the authenticated
Gateway identity matches a bounded profile from a verified compatibility bundle.
The canonical publisher endpoint is
`https://opencoven.github.io/coven-runtimes/openclaw/current.json`. Cave owns the
parser and permits only fixed event names, lifecycle values, and direct field
aliases; registry data cannot add executable code, arbitrary JSON paths, launch
arguments, logging behavior, or new envelopes.

## Release configuration

Every desktop release must provide these GitHub Actions secrets:

- `OPENCLAW_SCHEMA_REGISTRY_URL` — the credential-free HTTPS endpoint above.
- `OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEY`, or
  `OPENCLAW_SCHEMA_REGISTRY_PUBLIC_KEYS` — PEM Ed25519 public verification
  material. A rotation keyring contains one to four named keys.
- `OPENCLAW_SCHEMA_REGISTRY_CHECKPOINT` — compact JSON containing exactly the
  current positive `sequence` and lowercase SHA-256 `payloadHash` of the
  canonical unsigned bundle.

The release workflow validates these values, then maps them to
`NEXT_PUBLIC_COVEN_OPENCLAW_SCHEMA_REGISTRY_*` for packaging. They are public
verification anchors, never signing credentials. Development can use
`COVEN_OPENCLAW_SCHEMA_REGISTRY_*`; production deliberately ignores those
development variables.

Without a configured remote registry, the source-trusted built-in profile is
the offline and development baseline. It pins OpenClaw Gateway protocol v4,
`@openclaw/gateway-protocol@2026.7.2-beta.5`, the official outer
`AgentEventSchema` hash, and reviewed upstream revision
`d66b514a7e7565d89c87ab6f1a509623128093f0`. It is not a substitute for the
publisher and release anchors required to ship independently refreshable
compatibility.

## Publishing, checkpoint, and rollback

`OpenCoven/coven-runtimes` owns bundle review, the private signing key, and the
monotonic publisher. Private material must never enter Cave, GitHub release
secrets, logs, issue text, diagnostics, or a published bundle.

Publish an immutable bundle for each increasing sequence, then update
`openclaw/current.json` atomically. Before a Cave release, set the packaged
checkpoint to that reviewed bundle's sequence and canonical unsigned-payload
hash. Cave rejects lower sequences, different payloads at an accepted sequence,
partial snapshots, unauthorized profile retirement, invalid or expired
signatures, and conflicts with its bounded trust-anchor journal. A rejected
refresh keeps the last known good bundle; it never enables an opaque payload.

## Signature canonicalization (format 1)

Format 1 signs the UTF-8 bytes of the unsigned bundle. Remove the top-level
`signature` member, then recursively serialize with no whitespace. Arrays keep
their order. Object keys sort lexicographically using ECMAScript UTF-16
code-unit order. Strings and primitives use `JSON.stringify` escaping; object
separators are `,` and `:`, and there is no trailing newline. The detached
Ed25519 signature is standard base64 over exactly those bytes.

The format is frozen. Any change to canonicalization, escaping, or signed
members requires a new bundle format and explicit verifier.

```text
input unsigned value: { "z":"last", "runtime":"openclaw", "number":0, "nested":{ "unicode":"é", "quote":"\\\"", "line":"a\nb" }, "array":[true,2,null] }
canonical UTF-8 text: {"array":[true,2,null],"nested":{"line":"a\\nb","quote":"\\\"","unicode":"é"},"number":0,"runtime":"openclaw","z":"last"}
```

## Rotation and revocation

For routine rotation, first ship a Cave release whose keyring contains both the
active and retiring public keys. New bundles carry the signed `keyId`. After the
new signer has been served successfully for one release window, and no later
than the old bundle expiry, remove the prior key in a later Cave release.

Emergency revocation removes the compromised public key in a new release.
Caches signed only by that key then fail closed to the source-trusted built-in
profile or plain chat; Cave does not silently trust them. Record the endpoint,
public-key fingerprint, publisher owner, checkpoint, rotation date, and
retirement date in the release checklist.

## Diagnostics and deployment handoff

Compatibility diagnostics may name the runtime version, wire protocol, profile
ID, registry sequence, and a value-free event-shape fingerprint. They never
contain prompts, paths, credentials, dynamic keys, tool inputs or outputs, or
raw frames.

This repository contains the verifier, built-in profile, release guard, and
runtime projection. Closing the parent compatibility feature additionally
requires the signed sequence-one bundle to be published from
`OpenCoven/coven-runtimes` and production release secrets to be configured from
that reviewed bundle. Those publisher operations are external deployment work,
not a Cave-side code fallback.
