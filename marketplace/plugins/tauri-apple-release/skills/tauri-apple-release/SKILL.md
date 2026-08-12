---
name: tauri-apple-release
description: Triage which release gate failed, gather one complete credential packet, and validate signing and export before uploading to TestFlight or notarizing for macOS.
---

# Tauri Apple Release

Triage which release gate failed, gather one complete credential packet, and validate signing and export before uploading to TestFlight or notarizing for macOS.

## Use When
- Triage a failure into build correctness, Apple trust/signing, or release transport using exact Apple error numbers
- Assemble one complete Apple release packet covering metadata, upload auth, and distribution signing in a single ask
- Resolve a cert/profile mismatch by regenerating the App Store provisioning profile for the currently installed cert

## Guardrails
- Never paste private keys, .p8, .p12, provisioning profile contents, or app-specific passwords in chat; use 1Password or secrets
- Do not upload to TestFlight until export validation passes with an App Store distribution provisioning profile
- Request the full release packet once rather than drip-asking for individual fields like the issuer ID
- Never report `deep-research` as needing App Store Connect access. Research and authentication are separate capabilities: use research for public evidence, and name missing Apple credentials as the blocker.

## Authenticated App Store Connect access

Do not infer the latest TestFlight state from GitHub releases, tags, or workflow metadata. Query Apple directly.

When a repository provides `scripts/app-store-connect.mjs`, use its credential-safe commands:

```bash
APPLE_API_KEY=... \
APPLE_API_ISSUER=... \
APPLE_API_KEY_PATH=/secure/path/AuthKey.p8 \
APPLE_API_KEY_SUBJECT=user \
pnpm appstore:status --delivery-id <delivery-uuid> --wait

pnpm appstore:apps

pnpm appstore:status \
  --apple-id <numeric-app-id> \
  --bundle-version <CFBundleVersion> \
  --short-version <CFBundleShortVersionString> \
  --wait
```

The key ID, issuer ID, bundle ID, app ID, and delivery ID are identifiers. The `.p8`, `.p12`, provisioning profiles, and passwords are secrets and stay in a secret store or protected local path.

If no authenticated command can run, ask once for:

- a least-privilege App Store Connect API key ID, issuer ID, and `.p8` stored outside chat
- the numeric App Store Connect app ID
- for CI archive/export: an Apple Distribution `.p12` plus password and one App Store provisioning profile for every signed bundle, including extensions

## CI release contract

A complete TestFlight release job must:

1. Generate the canonical native iOS project and embedded resources.
2. Import a dedicated Apple Distribution certificate, not a Developer ID certificate.
3. validate each provisioning profile's exact application identifier, `get-task-allow=false`, and lack of provisioned devices.
4. Archive and export an App Store Connect IPA.
5. Run authenticated validation and upload.
6. Wait for App Store Connect processing and fail if it cannot confirm the build.
7. Remove temporary keychains, profiles, and API-key staging directories.

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
