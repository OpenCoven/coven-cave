# cave-sidecar.lock.json — pinned sidecar runtime components

*Spec · 2026-08-20 · Sage · pattern source: block/berd `goose-backend.lock.json` + `node-runtime.lock.json` (stamp-and-refuse semantics), adapted to Cave's composite sidecar. Analysis: `~/.coven/research/synthesis/berd-block-review-2026-08-20.md`.*

## Problem

Cave's desktop sidecar is a composite runtime, and its version pins live in five inconsistent places:

| Component | Where pinned today | State |
|---|---|---|
| Piper TTS | inline `case` in `scripts/sidecar-bundle.sh` (tag `2023.11.14-2`, per-platform SHA256) | pinned, but buried in shell |
| Kokoro / sherpa-onnx | inline `case` in `scripts/sidecar-bundle.sh` (`v1.13.4`, per-platform SHA256, espeak-ng-data SHA) | pinned, buried in shell |
| whisper.cpp | `scripts/whisper-runtime-bundle.sh` (`VERSION="v1.9.1"`) | pinned, separate file, no SHA-per-asset table in one place |
| Bundled Node | `NODE_BIN="$(command -v node)"` — whatever the build host has | **unpinned**; only loosely checked against `MANAGED_NODE_VERSION` elsewhere |
| `coven` binary | runtime PATH probing in `src/lib/coven-bin.ts` | **unpinned**; stale-binary bugs are documented in that file's header comment |

Consequences: "which sidecar am I actually running?" is unanswerable from one file; runtime bumps are invisible diffs in shell scripts; a build host with the wrong Node silently produces a different bundle.

## Design

One root lockfile, `cave-sidecar.lock.json`, following the existing `skills-lock.json` convention (`version` + keyed entries + hashes) and the archive manifest's digest discipline (`scripts/sidecar-archive-manifest.mjs`, schema v3).

### Schema (v1)

```json
{
  "version": 1,
  "components": {
    "node": {
      "kind": "host-toolchain",
      "version": "<MANAGED_NODE_VERSION>",
      "match": "major-minor"
    },
    "piper": {
      "kind": "release-asset",
      "repo": "rhasspy/piper",
      "tag": "2023.11.14-2",
      "assets": {
        "darwin-arm64": { "name": "piper_macos_aarch64.tar.gz", "sha256": "6b1eb03b…" },
        "darwin-x64":   { "name": "piper_macos_x64.tar.gz",     "sha256": "ced85c0a…" },
        "linux-x64":    { "name": "piper_linux_x86_64.tar.gz",  "sha256": "a50cb45f…" },
        "win32-x64":    { "name": "piper_windows_amd64.zip",    "sha256": "f3c58906…" }
      },
      "extraAssets": {
        "darwin-arm64": [{ "name": "piper-phonemize_macos_aarch64.tar.gz", "sha256": "78a9c28b…" }],
        "darwin-x64":   [{ "name": "piper-phonemize_macos_x64.tar.gz",     "sha256": "9ec6e300…" }]
      }
    },
    "kokoro": {
      "kind": "release-asset",
      "repo": "k2-fsa/sherpa-onnx",
      "tag": "v1.13.4",
      "assets": { "…per-platform, as in sidecar-bundle.sh today…": {} },
      "extraAssets": {
        "all": [{ "name": "espeak-ng-data.tar.bz2", "tag": "tts-models", "sha256": "4135ccf8…" }]
      }
    },
    "whisper": {
      "kind": "release-asset",
      "repo": "ggml-org/whisper.cpp",
      "tag": "v1.9.1",
      "assets": { "…moved from whisper-runtime-bundle.sh…": {} }
    },
    "coven": {
      "kind": "external-binary",
      "minVersion": "<lowest coven CLI version whose flags Cave requires>",
      "requiredFlags": ["--stream-json", "--continue"]
    }
  }
}
```

Rules:
- All SHA values are full SHA-256 hex, verified at download time (already the behavior — the values just move here).
- `node.match: "major-minor"` mirrors the existing `MANAGED_NODE_VERSION` prefix check in `src/lib/server/managed-node-toolchain.ts`; the lockfile becomes the single declaration and the constant is derived from or checked against it.
- `coven` is a **constraint**, not a build pin — Cave does not bundle coven. `coven-bin.ts` gains a version gate: resolved binary older than `minVersion` → surfaced as incompatible (same UX path as `unresolvedWindowsShim`), never silently used.
- Platform keys are `${process.platform}-${process.arch}`, matching `scripts/sidecar-target.mjs` conventions.

### Stamp-and-refuse (the Berd semantics)

1. `sidecar-bundle.sh` (via a small `scripts/sidecar-lock.mjs` reader) resolves every pin from the lockfile and, on success, writes a stamp `src-tauri/resources/.sidecar-lock-stamp.json`: `{ "lockDigest": "<sha256 of canonical lockfile bytes>", "builtAt": "<ISO>", "components": { name: resolvedVersion } }`.
2. `scripts/dev-app.sh` and the release path **fail closed** when a staged sidecar's stamp digest ≠ current lockfile digest — the fix is re-running the bundle, never editing the stamp.
3. Explicit local override: `CAVE_SIDECAR_UNLOCKED=1` skips the stamp check, prints a loud warning, and marks the stamp `"unlocked": true` so diagnostics (`src/lib/about-diagnostics.ts`) can show it.
4. Windows archive `manifest.json` gains the `lockDigest` field (schema v3 → v4) so the Rust extractor (`src-tauri/src/sidecar_archive_manifest.rs`) can verify the same identity end-to-end.

### Bump workflow

`node scripts/update-sidecar-lock.mjs <component> <tag>` — downloads the release assets for all platforms, computes SHA-256s, rewrites the lockfile entry, and prints a summary for the PR body. Pins never change outside a lockfile diff.

### Verification

- `scripts/sidecar-lock.test.mjs` — schema validation, digest determinism (key order canonicalization), stamp round-trip, refuse-on-drift.
- Contract test asserting `sidecar-bundle.sh` and `whisper-runtime-bundle.sh` contain **no** literal SHA-256 or release-tag strings after migration (grep-based, same spirit as Berd's `broker_source_stays_free_of_command_literals`).
- Existing suites must stay green: `sidecar-bundle.test.mjs`, `sidecar-archive-manifest.test.mjs`, `release-runtime.test.mjs`.

## Implementation plan (dependency-ordered)

| # | Work item | Depends on | Size |
|---|---|---|---|
| 1 | `cave-sidecar.lock.json` v1 + `scripts/sidecar-lock.mjs` (load, validate, canonical digest) + tests | — | S |
| 2 | Migrate Piper pins out of `sidecar-bundle.sh` into the lockfile | 1 | S |
| 3 | Migrate Kokoro/sherpa-onnx + espeak-ng-data pins | 1 | S |
| 4 | Migrate whisper.cpp pins from `whisper-runtime-bundle.sh` | 1 | S |
| 5 | Pin bundled Node: bundle fails if host `node --version` violates `node.match`; reconcile with `MANAGED_NODE_VERSION` | 1 | M |
| 6 | Stamp write in bundle + refuse-on-drift in `dev-app.sh` and release path + `CAVE_SIDECAR_UNLOCKED` override | 2, 3, 4 | M |
| 7 | `update-sidecar-lock.mjs` bump script + test | 1 | S |
| 8 | No-literal-pins contract test over both bundle scripts | 2, 3, 4 | S |
| 9 | Archive manifest schema v4 with `lockDigest` (JS writer + Rust reader) | 6 | M |
| 10 | `coven.minVersion` gate in `coven-bin.ts` + incompatible-binary UX + test | 1 | M |
| 11 | Surface lock state in About diagnostics (`about-diagnostics.ts`): digest, unlocked flag, per-component versions | 6 | S |
| 12 | CI: `sidecar-lock:check` job (schema valid, no literal pins, stamp fresh on release artifacts) | 7, 8 | S |

Ship order: **1 → (2,3,4 in parallel) → 5 → 6 → (7,8) → 9 → 12**, with 10 and 11 independent after their deps. Items 1–4 are pure moves of existing values (no behavior change) and are safe to land first; 6 is the first behavior change and the point of the whole exercise.

## Non-goals

- Not a customer/org config system (Berd's distro scope-fence applies).
- Does not pin skills (that is `skills-lock.json`) or npm deps (`pnpm-lock.yaml`).
- Does not bundle the `coven` binary; it only constrains the resolved one.

## Risks

- Windows path: the archive/stamp interaction must not break the launcher's versioned runtime cache — item 9 needs a Windows CI pass before release.
- `MANAGED_NODE_VERSION` double-declaration during migration (item 5): keep one authoritative side and a test asserting equality until the constant is derived.
- `coven` min-version gate (item 10) can strand users with old CLIs; the incompatible state must link to the upgrade path, not just refuse.
