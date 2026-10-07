# Grok Build compatibility registry

Grok Build's built-in profile is limited to the xAI-documented `text`, `thought`, `end`, and `error` `streaming-json` frames. It contains no tool-event aliases. A tool schema is enabled only when the exact locally resolved launcher advertises the value-bearing `--output-format streaming-json` option and a selected Ed25519-signed bundle explicitly names every envelope field and lifecycle event **and pins those aliases to exact locally probed Grok Build versions**. Help/version probes never receive credential-bearing environment variables and run no model request.

Release configuration is public verification material, never a signing key:

- `GROK_SCHEMA_REGISTRY_URL` — canonical credential-free HTTPS bundle URL.
- `GROK_SCHEMA_REGISTRY_PUBLIC_KEY`, or `GROK_SCHEMA_REGISTRY_PUBLIC_KEYS` — PEM Ed25519 trust anchor(s), with one to four key IDs for rotation. A bundle signed against a multi-key keyring must carry its exact `keyId`.
- `GROK_SCHEMA_REGISTRY_CHECKPOINT` — JSON `{ "sequence": number, "payloadHash": "<lowercase sha256>" }` that anchors first use and rollback resistance.

The release maps these to `NEXT_PUBLIC_COVEN_GROK_SCHEMA_REGISTRY_*`; production reads only those packaged anchors. Development may use `COVEN_GROK_SCHEMA_REGISTRY_*`, which production deliberately ignores. Registry downloads reject redirects, credentials, oversized or stalled bodies, malformed bundles, invalid signatures, checkpoint regressions, and cache-anchor rollbacks. The per-user cache is bounded, atomically replaced under a short writer lock, and keeps a bounded immutable high-water journal so a resumed stale writer cannot lower the accepted sequence. It is always reverified; an unknown or malformed selected event quarantines that schema in-process and future turns fall back to plain text. If a newer remote contract was previously accepted, its cache expires, or its anchor is missing/corrupt, Cave does not revive the older compiled parser; it waits in plain chat for a verified refresh. The compiled baseline also expires rather than parsing future output indefinitely. Do not publish a Grok tool schema until its precise stdout envelope is source-verified and captured from an approved non-production fixture. Never store a private key in this repository, app configuration, or release secrets.

## Evidence

Verified on 2026-07-26 from xAI's [Grok Build overview](https://docs.x.ai/build/overview), which documents headless `grok -p ... --output-format streaming-json`, and the upstream [headless-mode source documentation](https://github.com/xai-org/grok-build/blob/47348d13ec4508dcfe440e34c6d511bb02998fb2/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md) at Grok Build revision [`47348d13ec4508dcfe440e34c6d511bb02998fb2`](https://github.com/xai-org/grok-build/tree/47348d13ec4508dcfe440e34c6d511bb02998fb2). Those sources establish the baseline text/thought/end/error transport only; they do **not** document tool lifecycle envelope names. No live Grok capture is stored or required. Future signed schemas need separately recorded source evidence for every added event and field before release owners publish them.

## Native ACP qualification (2026-10-03)

Current help uses multiline output choices and short/long option aliases.
The probe reads the output option's own complete stanza and records an ACP
constraint. That constraint requires an exact-version schema for any structured
decoding; it cannot select the unversioned legacy text baseline.

The optional data-only `eventTypes.toolLifecycle` group handles ACP status-tagged
calls and updates. Pending is requested, in_progress is running, and declared
terminal states are results. A statusless location update is ignored. These
schemas require exact versions and nonempty id/name/state/terminal aliases;
unknown event names and states retain the quarantine path. Event-name groups
allow at most 32 entries; field aliases stay capped at 8.

The [1.0.46 qualification fixtures](../src/lib/fixtures/grok/README.md) include
native capture provenance and an unsigned descriptor proposal. Local signer /
verifier / cache checks use ephemeral test keys only. Canonical signed admission
and stock-trust live Cave acceptance remain pending.
