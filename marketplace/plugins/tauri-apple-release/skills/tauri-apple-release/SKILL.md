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

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
