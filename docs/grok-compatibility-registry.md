# Grok Build compatibility registry

Grok Build's built-in profile is limited to the xAI-documented `text`, `thought`, `end`, and `error` `streaming-json` frames. It contains no tool-event aliases. A tool schema is enabled only when the exact locally resolved launcher advertises the value-bearing `--output-format streaming-json` option and a selected Ed25519-signed bundle explicitly names every envelope field and lifecycle event. Help/version probes never receive credential-bearing environment variables and run no model request.

Release configuration is public verification material, never a signing key:

- `GROK_SCHEMA_REGISTRY_URL` — canonical credential-free HTTPS bundle URL.
- `GROK_SCHEMA_REGISTRY_PUBLIC_KEY`, or `GROK_SCHEMA_REGISTRY_PUBLIC_KEYS` — PEM Ed25519 trust anchor(s), with one to four key IDs for rotation. A bundle signed against a multi-key keyring must carry its exact `keyId`.
- `GROK_SCHEMA_REGISTRY_CHECKPOINT` — JSON `{ "sequence": number, "payloadHash": "<lowercase sha256>" }` that anchors first use and rollback resistance.

The release maps these to `NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_*`. Development may use `COVEN_GROK_SCHEMA_REGISTRY_*`. Registry downloads reject redirects, credentials, oversized bodies, malformed bundles, invalid signatures, checkpoint regressions, and cache-anchor rollbacks. The per-user cache is bounded, atomically replaced under a short writer lock, and always reverified; an unknown or malformed selected event quarantines that schema in-process and future turns fall back to plain text. Do not publish a Grok tool schema until its precise stdout envelope is source-verified and captured from an approved non-production fixture. Never store a private key in this repository, app configuration, or release secrets.
