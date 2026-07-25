# OpenCode compatibility registry

Coven Cave can update OpenCode JSON event schemas independently of an app release only when its packaged build includes a trusted registry configuration. The registry publishes signed, versioned JSON bundles; Cave embeds the corresponding Ed25519 **public** key and accepts a bundle only after signature, expiry, schema, and monotonic-sequence validation.

## Release configuration

Every desktop release must provide these GitHub Actions secrets:

- `OPENCODE_SCHEMA_REGISTRY_URL` — canonical HTTPS URL for the signed OpenCode bundle.
- `OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY` — PEM-encoded Ed25519 public key that verifies that bundle.

The release workflow maps these values to `NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_URL` and `NEXT_PUBLIC_COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY`, then runs `scripts/check-opencode-registry-release.mjs` before packaging. They are public verification material, intentionally compiled into the desktop application. A release fails closed if either value is missing, non-HTTPS, or not an Ed25519 key.

Development and test processes may inject `COVEN_OPENCODE_SCHEMA_REGISTRY_URL` and `COVEN_OPENCODE_SCHEMA_REGISTRY_PUBLIC_KEY` instead. Without a configured registry, the source-trusted built-in profile is the offline/development baseline; it does not provide independently deployed schema recovery and must not be used to ship a desktop release.

## Publishing and rotation

The registry publisher owns the private signing key; it must never be placed in Cave, the release workflow, logs, or issue text. Publish an immutable bundle for each increasing `sequence`, with canonical RFC 3339 UTC timestamps and the detached Ed25519 signature over the bundle payload. Cave rejects rewrites at an existing sequence and lower sequences even after a cache entry expires.

To rotate a key, publish a Cave release carrying the new public key before publishing bundles signed only by that key. Keep the prior key available to the registry publisher until clients on the preceding Cave release have a supported migration path; an emergency rotation requires a Cave release first. Record the registry endpoint, public-key fingerprint, owner, and rotation date in the release checklist.
