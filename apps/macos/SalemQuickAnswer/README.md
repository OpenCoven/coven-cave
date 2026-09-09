# Salem Quick Answer for macOS

Tracking: OpenCoven/coven-cave#5329 and #5330 under #5323.

This is the native Cave-owned menu-bar client for Salem Quick Answer. The app uses the read-only `opencoven.salem-brief/v1` contract and keeps live answers separate from versioned offline reference pitches.

## Current architecture

```text
canonical OpenCoven sources
          ↓
       Salem
   POST /api/brief
          ↓
 scoped salem.brief.read bearer
          ↓
 Salem Quick Answer (macOS)
```

The Mac never receives provider, Upstash, reindex, admin, GitHub research, Threads, Psyche, Coven, or memory-mutation credentials.

## User flow

- `⌥ Space` opens/closes the menu-bar popover without an Accessibility permission dependency.
- Ask a question and receive `sayThis` first.
- Claim status, confidence, and knowledge freshness remain separate concepts.
- Caveats and evidence expand on demand.
- `Access` stores/removes the scoped raw bearer in this Mac's Keychain.
- `Pitches` remains usable without the network and is explicitly labeled as reference language, not current implementation/release status.

## Live trust behavior

The client does not render a successful HTTP response merely because it decodes as ordinary JSON. `StrictBriefDecoder` requires the exact v1 object shape and checks important epistemic invariants before the answer reaches UI state:

- unknown fields or schema versions are rejected;
- known claim statuses require evidence;
- `unknown` must remain low-confidence and non-generalizable;
- `implemented` needs pinned implementation evidence;
- `verified` needs pinned verification evidence;
- duplicate evidence IDs are rejected;
- evidence URLs must be HTTPS without embedded credentials or query parameters;
- moving/malformed revisions are rejected;
- known freshness requires a content hash and canonical index/check timestamps;
- `safeToGeneralize` cannot override stale/non-current/weak evidence.

A failed validation becomes `invalidResponse`; the suspect answer is withheld.

## Explicit failure states

The UI distinguishes:

- offline;
- unauthorized;
- revoked credential;
- rate limited;
- timeout;
- invalid/unversioned response;
- answer-model unavailable;
- Salem service unavailable;
- generic bounded failure;
- low-confidence successful answer;
- stale successful answer.

No automatic retry loop runs in this slice, and no previous live answer is substituted as fresh truth.

## Credential storage

The raw `salem.brief.read` token is stored as a generic-password Keychain item using `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. It is not written to `UserDefaults`, source files, plist resources, or query history.

The server-side hash/revocation contract is defined by the Salem backend #5328 slice. The client supports local save, replace, read, and delete operations.

## Generate and run

Requires macOS, Xcode 16+, and XcodeGen.

```sh
cd apps/macos/SalemQuickAnswer
xcodegen generate
open SalemQuickAnswer.xcodeproj
```

Command-line verification:

```sh
cd apps/macos/SalemQuickAnswer
xcodegen generate
xcodebuild test \
  -project SalemQuickAnswer.xcodeproj \
  -scheme SalemQuickAnswer \
  -destination 'platform=macOS'
```

The generated `.xcodeproj` is not source-of-truth; `project.yml` is canonical, matching Cave's native Apple project convention.

## Portable source check

From the repository root:

```sh
node scripts/verify-quick-answer-macos.mjs
```

This is not a substitute for Xcode compilation. It verifies the principal source boundary on non-macOS CI/dev hosts: menu-bar/hot-key wiring, explicit failure states, offline pitch language, live endpoint, Keychain use, strict decoder presence, and absence of provider/admin infrastructure secrets.

## Deterministic tests

Ordinary XCTest uses injected services and mock URL loading; it does not require live Salem or OpenAI.

Coverage includes:

- principal UI state transitions;
- offline pitch completeness;
- strict Brief valid/invalid decoding;
- Keychain save/read/replace/delete in an isolated test namespace;
- authorized request bearer/header behavior;
- missing credential prevents network access;
- revoked and rate-limited responses remain distinct;
- future schema responses are withheld.

The original `FixtureBriefService` remains available only for deterministic development/test injection. The production app instantiates `LiveBriefService`.

## Live integration evidence still required

A repository-native build can prove source behavior without proving that the currently deployed Salem environment accepts the new scoped endpoint. Before #5330 can close, record one authorized live `/api/brief` request against the exact deployed backend revision and verify that the returned source/freshness metadata survives strict decoding.

## Trust boundary

The bundled pitches are reference language only. They are not evidence that a feature is currently implemented, verified, released, private, secure, or universally compatible. Live failures never silently fall back to a pitch as though it were the answer to the current question.
