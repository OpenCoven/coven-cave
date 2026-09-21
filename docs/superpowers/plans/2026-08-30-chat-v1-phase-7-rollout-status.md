# Chat v1 Phase 7 — Packaging, Compatibility, Publishing, and Rollout: Verified Program Status

> **Current refresh — 2026-09-21:** the consolidated #4781 checklist was
> reconciled against live state on every owner repository. Cave v0.4.2 is a
> signed, notarized, rollback-ready line (baseline v0.4.1, updater chain PASS,
> installed-app Client v1 smoke ok). Chat's only successful release run is an
> `allow_unsigned` rehearsal (adhoc-signed, un-notarized); all five
> `@opencoven/*` SDK packages remain private and unpublished; the Coven client
> crate is unrenamed and unpublished; the protected conformance canary still
> fails on `win32-x64`; the acceptance results directory is still empty.
> #4781 remains open and blocked. See the 2026-09-21 refresh section below.

> **Previous refresh — 2026-09-04:** Phase 7 remains blocked in canonical
> Beads; it is no longer tracker-unverifiable. Chat's `v0.0.1-demo.1`
> prerelease is macOS-arm64 demo evidence, not the signed cross-platform
> production/updater candidate required by this program. Coven has advanced to
> v0.4.3, but the planned client crate publication remains absent. Phase 1 is
> closed canonically; GitHub #4833 is only a stale open mirror. The missing
> acceptance record and Phase 7 gate evidence remain real blockers.

Issue: [OpenCoven/coven-cave#4820](https://github.com/OpenCoven/coven-cave/issues/4820) · Bead `cave-j65ie` · Lane `program-coordination`

**Verified: 2026-08-30.** Read-only verification. This document records verified program status only; it closes nothing and changes no bead.

## Refresh — 2026-09-21 (consolidated checklist reconciled against live state)

**Verified: 2026-09-21, 06:00–06:35 UTC.** Read-only reconciliation of the
[#4781](https://github.com/OpenCoven/coven-cave/issues/4781) consolidated
checklist (which now owns the former #4820 parent gate), plus the executable
evidence tooling run on a darwin-arm64 host (macOS 26.6.2, Node v24.18.1).
This refresh changes no release, deployment, hold, or tracker state and
authorizes nothing. Facts only.

**Bases read:** `OpenCoven/coven-cave` `origin/main` at `376c51f2d`;
`OpenCoven/chat` `origin/main` at `01adf7185`; `OpenCoven/sdk` `origin/main`
at `d94ed37c9` (PR #306, 2026-09-21); `OpenCoven/coven` default branch via the
contents API. Registry probes: registry.npmjs.org and crates.io (both 06:12
UTC). GitHub Actions runs read through the REST API in the same half hour.

### Per-item verdict

| Checklist item (legacy id) | Verified state 2026-09-21 | Verdict |
|---|---|---|
| Cave/Coven authority compatibility releases (`cave-mbekl`) | **Cave half delivered and re-verified.** v0.4.2 published 2026-09-14 from annotated tag `22d41fe44` → commit `ecdcdcf8a`; release run `34901963985` succeeded end to end, including *Verify tag matches stamped source*, *Verify rollback readiness*, signed + notarized macOS DMGs, MSI, AppImage, `latest.json`, and `SHA256SUMS`. Today the v0.4.2 Client v1 release smoke (script set archived from the `v0.4.2` tag) passed against the **installed** `/Applications/CovenCave.app` 0.4.2 server on `127.0.0.1:3020`: `ok (release 0.4.2, instance da3bafc4-…)`. `export-client-v1-contract.mjs --check` passes on `main`. **Coven half not delivered.** Coven v0.4.4 is published (2026-09-14), but `crates/coven-client` is still `coven-client` 0.1.0 (plan name `opencoven-coven-client`); `.github/workflows/release-crates.yml`, `scripts/verify-coven-client-package.mjs`, `crates/coven-client/{README.md,tests/package_contract.rs}`, and `docs/reference/coven-client-crate.md` are absent; crates.io: `opencoven-coven-client` does not exist. | Cave: **verified**. Coven: **blocked** (owner: OpenCoven/coven) |
| Chat signed packages/updater (`cave-gcb0i`, historical #4776) | `.github/workflows/release.yml` (signed-tag pipeline) and `docs/releasing.md` now exist on Chat `main`. The only successful run, `35174981698` (2026-09-17, `workflow_dispatch` on `main` at `99e7dac78`), was an **`allow_unsigned` rehearsal**: its logs warn *"Apple signing material is absent or incomplete; producing an UNSIGNED, un-notarized macOS build"* and the Windows equivalent. The run artifact `OpenCoven Chat_0.0.1_aarch64.dmg` (SHA-256 `c8844dd37262ffa7159cdc206118a4ca5654ac30d52cd053e3936eb0e7b21de5`) was downloaded and inspected: `Signature=adhoc`, `TeamIdentifier=not set`, no notarization ticket. The `v0.0.1` tag-push run `35164730079` failed; no `v0.0.1` GitHub Release exists — only the `v0.0.1-demo.1` prerelease (macOS aarch64 only, 2026-09-02). `src-tauri/tauri.conf.json`: `createUpdaterArtifacts: false`, no updater plugin configuration. `docs/rollback.md`, `scripts/verify-package.mjs`, `scripts/release-context.mjs`, and `compatibility-canary.yml` remain absent. | **Blocked** on Apple Developer ID/notarization and Windows code-signing material in the `release-signing` environment, an updater keypair, and a signed tag (owner: OpenCoven/chat; credentials are human-held) |
| SDK publishing and documentation (`cave-563z7`) | All five `@opencoven/*` packages are `private` (`sdk-core`, `cave-client`, `coven-client`, `sdk` at 0.0.1; `dev-cli` at 0.1.0) and return **404** from registry.npmjs.org (`@opencoven/cli`, Coven-owned, is the only published name). `release.config.json`: `publishingEnabled: false`, `conformanceEvidence.aggregateRecord: null`; `RELEASING.md` records a frozen private 0.0.1 candidate (`96804bc48`) with a **BLOCK** disposition and states that `@opencoven/dev-cli` "is not part of the 0.0.1 release group" and "must not [be] pack[ed], publish[ed], attest[ed]". `compatibility/manifest.json`, `docs/pairing.md`, `docs/migration.md` absent; no SDK release workflow runs exist. `which opencoven` → not found on this host. | **Blocked** (owner: OpenCoven/sdk release owner). **Scope conflict to decide:** this issue's `cli-install`…`cli-scaffold` steps require a published `@opencoven/dev-cli`, which the SDK release decision currently excludes. |
| Cross-repository compatibility canaries (`cave-as76u`) | Chat has a protected `client-v1-conformance.yml` (`workflow_dispatch`, `main` only). SDK `docs/client-v1-cross-repository-results/README.md`: *"There is no passing record yet."* Every dispatch since 2026-09-16 (`35138402347`, `35146928092`, `35417839851`, `35500732205`) failed at `platform-conformance (win32-x64)` while `darwin-arm64` and `linux-x64` passed; run `35566636457` (in progress at 06:00 UTC today) already shows `win32-x64` failed. No scheduled minimum/latest/main canary exists in any repository (`compatibility-canary.yml`, `authority-canary.yml` absent). | **Blocked** on the Windows native conformance job; scheduled canaries not implemented (owner: OpenCoven/chat + OpenCoven/sdk) |
| OS acceptance and rollout (`cave-udcn7`, this issue) | `docs/release-acceptance-results/` still holds only `.gitkeep`. No Chat candidate exists to install, and no CLI exists to install, so no step of the three-OS journey can be executed honestly. Tooling verified today (see commands below): 19 steps listed; a fresh `template 0.4.2` validates `incomplete` with the expected field errors; stage table intact; 129 tooling tests pass. | **Not executed — blocked** by the three rows above and by the human-operator requirement on fresh macOS, Windows, and Linux machines |
| Production v1 gate (`cave-ilh1h`, historical #4777) | Cannot pass while any row above is blocked. Cave-side gate commands and their results are retained below as the Cave contribution to the eventual gate record. | **Not passable** |
| Pilot and rollback | **Prior stable and rollback metadata verified today** for the live Cave line: `release-rollback-readiness.mjs` for `v0.4.2` → `ready=true`, baseline `v0.4.1` (published 2026-09-09), platforms `darwin-aarch64, darwin-x86_64, linux-x86_64, windows-x86_64`, nothing missing, `baseline-waived=false`; `verify-release-updater.mjs` → **PASS** (`latest.json` 0.4.2 == release v0.4.2, all four platform signatures valid against key `ab97b0f03eb6dbea`). No staged cohort, pilot health, or observation window exists for a Chat candidate. The rollback drill was **not** run: its second step republishes `latest.json` on the live Cave release, which is not authorized by this reconciliation and is independently held by #5339. | Prior-stable verification: **verified**. Pilot and drill: **not observed — blocked** |

### Commands executed 2026-09-21 (darwin-arm64 host) and results

```bash
# Cave checkout main 376c51f2d
node scripts/release-acceptance.mjs steps                    # 19 steps (12 desktop + 7 CLI)
node scripts/release-acceptance.mjs template 0.4.2 > t.json  # exit 0
node scripts/release-acceptance.mjs validate t.json          # acceptance: incomplete; 3 OS × 19 pending;
                                                             # ✗ candidate.commit / artifacts[0] / osVersion / caveVersion (expected)
node scripts/release-rollout.mjs stages                      # maintainer 0% 24h · private-beta 0% 48h · stable-5 5% 24h · stable-25 25% 48h · stable-100
node --test scripts/release-acceptance.test.mjs scripts/release-rollout.test.mjs \
  scripts/release-rollback-readiness.test.mjs scripts/client-v1-release-smoke.test.mjs \
  scripts/verify-release-updater.test.mjs                    # 129 pass, 0 fail
node scripts/export-client-v1-contract.mjs --check           # exit 0
node scripts/verify-release-updater.mjs                      # RESULT: PASS — updater chain verified end to end (v0.4.2)
RELEASE_TAG=v0.4.2 GITHUB_REPOSITORY=OpenCoven/coven-cave GITHUB_TOKEN=… \
  node scripts/release-rollback-readiness.mjs                # ready=true baseline-tag=v0.4.1 rollback-platforms=4/4

# Installed-artifact smoke: script set from the v0.4.2 tag against the running CovenCave.app 0.4.2 server
git archive v0.4.2 scripts/client-v1-release-smoke.mjs package.json \
  src/lib/server/client-v1/contract-fixture.json | tar -x -C <scratch>
node <scratch>/scripts/client-v1-release-smoke.mjs --origin http://127.0.0.1:3020
                                                             # ok (release 0.4.2, instance da3bafc4-5f76-4fa9-94bc-490c0d7ffaf3)

# Chat unsigned-rehearsal artifact inspection (run 35174981698, installers-macos-aarch64)
codesign -dv --verbose=2 "OpenCoven Chat.app"                # Signature=adhoc, TeamIdentifier=not set
xcrun stapler validate "OpenCoven Chat.app"                  # does not have a ticket stapled to it
```

Not run, deliberately: `pnpm release:verify` and `pnpm test:api` on the dev
checkout (version `0.5.0`, unreleased; these gates already ran inside the
v0.4.2 release run), and `release-rollout.mjs restore-plan`/the drill itself
(mutating; not authorized here).

### Dependency and hold state

- Phase 1 gate [#4833](https://github.com/OpenCoven/coven-cave/issues/4833): **closed** 2026-09-09. Phase 2 gate [#4839](https://github.com/OpenCoven/coven-cave/issues/4839): **closed** 2026-09-15. Phase 2 real-authority conformance [#4838](https://github.com/OpenCoven/coven-cave/issues/4838): **open** (updated 2026-09-20). #4837 no longer resolves as an issue in this repository. Phase 6 gate (`cave-b6wsl`): still no tracker card (search returns only #4776).
- [#5339](https://github.com/OpenCoven/coven-cave/issues/5339) (P0 security release hold): **open**; its 2026-09-20 reconciliation keeps per-target hold disposition pending. It remains independently binding on any rollout.
- Cave Project 9 status for #4781 could not be read: the available token lacks the `read:project` scope. Project coverage is therefore **unknown**; Cave Board/task execution records were not searched (**partial**).

### Progress later on 2026-09-21 (after the reconciliation above)

Executed in the same day, after the reconciliation was recorded. Each item is
verified by a merge commit or an issue reference; nothing below publishes,
signs, or rolls out anything.

| Row | Delivered | Evidence | Still human-held |
|---|---|---|---|
| Coven authority compatibility release (Coven half) | Crate packaged as `opencoven-coven-client` (library name stays `coven_client`; `coven-cli` unchanged), publication metadata and explicit include list, crate README, `tests/package_contract.rs`, `scripts/verify-coven-client-package.mjs`, `docs/reference/coven-client-crate.md`, and `release-crates.yml` (signed `coven-client-v*` tag on `main` → workspace gates → `cargo package` → verifier → `cargo publish --dry-run` → publish only with `CARGO_REGISTRY_TOKEN` in the `crates-io-release` environment, failing closed otherwise). Review points (immutable action SHAs, `gpg.format ssh` before `git verify-tag`, release-stress selector) fixed before merge. | [OpenCoven/coven#1140](https://github.com/OpenCoven/coven/issues/1140) → [#1141](https://github.com/OpenCoven/coven/pull/1141), merged `68da978c7e2308a8a90e692a0f21772f575f6986`. Local: `opencoven-coven-client-0.1.0.crate` sha256 `368d23fa679f5ca039c52afafec1915c2befffa27aaee52b4a5f041dfe2cb7ae`, dry-run ok. | crates.io name ownership + `CARGO_REGISTRY_TOKEN`; a signed `coven-client-v0.1.0` tag |
| Cave authority compatibility release (Task 2 residue) | `release.yml` had **no** Client v1 gate and `docs/client-v1-release.md` did not exist. Both validation paths now run `export-client-v1-contract.mjs --check` and the Client v1 release smoke against the built `server.mjs` after the web build and before any installer/checksum/updater job; the workflow contract test pins the ordering and refuses conditional or advisory gates. | [#5513](https://github.com/OpenCoven/coven-cave/pull/5513), merged `__PR5513_SHA__`. Local: contract tests 20/20, fixture check exit 0, the smoke step verbatim against the built server → `ok (release 0.5.0)`. | — |
| Chat signed packages/updater | Owner-repo tracker opened with the verified state and the four decisions/prerequisites (window minimum 820×600 vs 480×520, `opencoven-chat` protocol, updater keypair + `createUpdaterArtifacts`, Apple/Windows signing secrets). `scripts/verify-package.mjs` is deliberately **not** written until those are decided; asserting a contract the config does not declare would be fiction. | [OpenCoven/chat#356](https://github.com/OpenCoven/chat/issues/356) | all four items |
| Cross-repository canaries | Not touched. [OpenCoven/chat#219](https://github.com/OpenCoven/chat/issues/219) has a live owner and a root cause posted 2026-09-21 (`MAX_PATH` overflow in the `aws-lc-sys` build script on the Windows lane). Chat's `contract-canary.mjs` already pins exact SDK/Cave revisions; the plan's minimum/latest/main matrix does not exist and was not started, to avoid a second design in an actively worked lane. | — | Windows lane repair; matrix design |
| SDK publishing | Not touched, by decision. The SDK **formally excluded** `@opencoven/dev-cli` from its release ([sdk#37](https://github.com/OpenCoven/sdk/issues/37), `docs/superpowers/plans/2026-08-25-cli-release-scope.md`, 2026-08-25): native trust requirements unmet; a standalone CLI needs a separate reviewed design. It also chose a release-manifest/lock design over the plan's `compatibility/manifest.json`. | — | SHIP disposition (#40), aggregate record, publication |
| Pilot and rollback | Non-mutating drill evidence for the live line: a v0.4.2 state file with the verified readiness verdict → `release-rollout.mjs gate` = **hold** (acceptance incomplete, five metrics unmeasured, five canaries missing, 0h of 24h observed), `restore-plan` prints the bounded three-step drill naming v0.4.1. The drill's mutating step was not run. | this record | cohort, observation window, drill execution, #5339 disposition |

**Consequence for the `cli-*` acceptance steps.** They now conflict with an
owner-repo decision, not merely an unpublished package. Until Val either
commissions the standalone-CLI design or amends this issue and
`docs/workflows/release-acceptance.md` to defer the seven `cli-*` steps, the
acceptance record cannot reach `complete` and the rollout gate cannot advance.

### What clears each blocker (imperative, by owner)

1. **OpenCoven/chat** — provision Apple Developer ID + notarization and Windows code-signing secrets in the `release-signing` environment; generate the updater keypair and enable `createUpdaterArtifacts`; land `docs/rollback.md` and `scripts/verify-package.mjs`; push a signed `v0.0.1` (or `-rc.N`) tag and let `release.yml` publish. Fix the `platform-conformance (win32-x64)` job.
2. **OpenCoven/sdk** — obtain an accepted three-platform protected aggregate (needs the Windows job above), set `conformanceEvidence.aggregateRecord`, obtain the #40 SHIP disposition, flip `publishingEnabled`, and publish the 0.0.1 group through trusted publishing. Add `compatibility/manifest.json`, `docs/pairing.md`, `docs/migration.md`.
3. **Decision needed (Val):** either publish `@opencoven/dev-cli` so the `cli-*` acceptance steps can run as written, or amend this issue and `docs/workflows/release-acceptance.md` to drop or defer those steps. Until decided, the acceptance record cannot reach `complete`.
4. **OpenCoven/coven** — rename/package `opencoven-coven-client`, add the crate contract test, verify script, docs, and `release-crates.yml`; obtain crates.io authority.
5. **Cross-repository** — add the scheduled minimum/latest/main canaries and retain outcomes against authenticated identities.
6. **Then, humans on fresh machines** — execute the journey on macOS, Windows, and Linux from packaged installs with no source checkout; record one `docs/release-acceptance-results/<tag>.json`; stage `maintainer` → `private-beta` → `stable-5` with observed metrics; run the bounded rollback drill; dispose the #5339 hold per target.

**Verdict after refresh:** #4781 remains **open and blocked**. Cave's half of the compatibility release and the prior-stable/rollback-metadata verification are verified today; every other checklist row is blocked on artifacts, credentials, or observations that do not exist yet. Nothing in this refresh substitutes for them.

## Refresh — 2026-08-30 (second sweep, re-verified against upstream main)

**Refreshed: 2026-08-30 ~15:00 UTC (second read-only sweep).** This record was first written against `origin/main` at `dacbe6173` on the morning of 2026-08-30 and merged to `CompleteDotTech/coven-cave` `main` via PR [CompleteDotTech/coven-cave#6](https://github.com/CompleteDotTech/coven-cave/pull/6) (merge commit `2d73f06e`, 2026-08-30T10:44:41Z). It has since reached `OpenCoven/coven-cave` `main` through the fork-to-upstream sync PR [#5211](https://github.com/OpenCoven/coven-cave/pull/5211) (commit `f4331e094`), which also landed the companion record [`2026-08-30-chat-v1-phase-7-acceptance-status.md`](2026-08-30-chat-v1-phase-7-acceptance-status.md) — a deeper `cave-udcn7`/[#4781](https://github.com/OpenCoven/coven-cave/issues/4781) verification with live tooling runs. This refresh re-verifies the record against current upstream main. Facts only; closes nothing.

**Re-verification base:** `OpenCoven/coven-cave` `origin/main` at `bdbf971593` ("Bake absolute node path into the beads-jsonl merge driver", PR #5212, committed 2026-08-30T12:30:42Z), tree inspected locally 2026-08-30 ~15:00 UTC; tracker reads via the GitHub REST API in the same hour.

### What changed since the original verification (`dacbe6173` → `bdbf971593`)

- Exactly two commits: the [#5211](https://github.com/OpenCoven/coven-cave/pull/5211) fork sync (which carries the records themselves) and #5212 (`bdbf97159`; beads-jsonl merge driver, plus CI-ops scripts `scripts/cancel-stuck-action-runs.mjs` and `scripts/install-git-hooks.*`). **Neither touches a Phase 7 acceptance surface.**
- `.beads/issues.jsonl` on `main` is still the stale four-row July pilot export (4 lines, `cave-hlv*` rows only). Beads remains unreadable from this environment, so the tracker-mirror method stands.

### Tracker re-verification (REST, 2026-08-30 ~15:00 UTC) — unchanged

| Check | Result |
|---|---|
| [#4820](https://github.com/OpenCoven/coven-cave/issues/4820) (epic mirror, `cave-j65ie`) | **open**, 0 comments, `updated_at` still 2026-08-21T20:50:41Z |
| [#4781](https://github.com/OpenCoven/coven-cave/issues/4781) (`cave-udcn7`) | **open**, 2 comments, `updated_at` still 2026-08-22T04:14:03Z |
| [#4776](https://github.com/OpenCoven/coven-cave/issues/4776), [#4777](https://github.com/OpenCoven/coven-cave/issues/4777), [#4778](https://github.com/OpenCoven/coven-cave/issues/4778) | still closed 2026-08-21T07:24:2x–3xZ as accidental repository-issue conversions; no new evidence |
| [#4833](https://github.com/OpenCoven/coven-cave/issues/4833) (Phase 1 gate) and [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) (Phase 2 gate) | both **open**; `updated_at` unchanged (2026-08-22 and 2026-08-23 respectively) |
| Mirror cards for `cave-mbekl` / `cave-563z7` / `cave-as76u` | still none — issue search 2026-08-30 ~15:00 UTC returns only body references inside #4776–#4781 |
| New issues created since 2026-08-30T10:00Z | #5217, #5220 (Coven Automations program) — not Phase 7 beads |
| PRs merged since 2026-08-30T10:00Z | #5211 and #5212 only — neither advances a Phase 7 bead |

### State changes this refresh records

1. **The `cave-7yo` collision branch is gone.** `phase1a/cave-pairing-authority` — carried below as "unchanged at `287497dd3` with no PR" — now returns 404 on both `OpenCoven/coven-cave` and `CompleteDotTech/coven-cave` (checked 2026-08-30 ~15:00 UTC). No PR ever landed from it; tip `287497dd3` ("fix(client-v1): require explicit admin authorization", 2026-08-21) is still resolvable as a dangling commit but is **not an ancestor of `main`** — never landed. The 10-file collision with merged #4785 on `src/app/api/client/v1/health/route.ts` is therefore resolved by branch deletion/abandonment, not by landing that work. Whether Bead `cave-7yo` itself is closed is unverifiable here (Beads authoritative, unreadable).
2. **The `route.ts` surface evolved via #5179, not `287497dd3`.** `src/app/api/client/v1/health/route.ts` last changed through #4785 (`96627be5a`, 2026-08-21) and #5179 (`e74078a14`, 2026-08-29, "test(client-v1): add packaged compatibility controls" — explicit admin authorization plus `src/lib/server/client-v1/conformance-compatibility.ts`, 1,011 insertions). #5179 predates the original verification base but was not in its artifact inventory; it is Cave-side compatibility tooling, listed here for completeness. No Phase 7 bead id is attached to it anywhere in the tracker text this sweep can find.
3. **The record is now on upstream `main`** (see the refresh header) — this document's location is canonical upstream, no longer fork-only.

### Owner-repository probes re-run (2026-08-30 ~15:00 UTC) — all unchanged

- `OpenCoven/chat`: **0 releases, 0 tags**; workflows are still only `ci.yml` + `ci-image.yml`; `docs/releasing.md`, `docs/rollback.md`, `docs/release-acceptance.md`, `docs/production-rollout.md`, `scripts/verify-package.mjs`, and `scripts/release-context.mjs` remain absent from `main`.
- `OpenCoven/sdk`: `release.yml` still present; `authority-canary.yml`, `compatibility/manifest.json`, `docs/pairing.md`, and `docs/migration.md` remain absent; tags are `archive/*` and process tags only — **no version/release tags**; `@opencoven/dev-cli`, `@opencoven/sdk`, and `@opencoven/core` still return 404 from registry.npmjs.org (checked 2026-08-30 ~15:00 UTC).
- `OpenCoven/coven`: `crates/coven-client` is still `coven-client` 0.1.0 (the plan's publish-time name is `opencoven-coven-client`); `docs/reference/coven-client-crate.md`, `scripts/verify-coven-client-package.mjs`, and `.github/workflows/release-crates.yml` remain absent; crates.io returns 404 for both `opencoven-coven-client` and `opencoven-cave-client` (checked 2026-08-30 ~15:00 UTC). The repo does carry real version tags (latest `v0.4.1`) — the gap is crate publication/packaging, not release tagging.

### Verdict after refresh — UNCHANGED

- **Criterion 1 — "All Phase 7 implementation and verification beads are closed": still NOT satisfied.** #4820 and #4781 are open; #4776/#4777/#4778 remain accidental closures; `cave-mbekl`/`cave-563z7`/`cave-as76u` still have no tracker cards; `cave-0wg` is still the only verifiably closed Phase 7 execution bead.
- **Criterion 2 — "The Phase 7 gate records passing commands and artifacts": still NOT satisfied.** No Phase 7 gate record document exists on `origin/main` at `bdbf971593` (`docs/workflows/` contains none; `docs/release-acceptance-results/` still contains only `.gitkeep`); the gate's only mirror [#4777](https://github.com/OpenCoven/coven-cave/issues/4777) still records no commands and no artifacts.

Everything else in this document — the per-bead table, dependency chain, and coverage note — was re-checked in the same hour and stands as written.

## Method and limits

Sources read on 2026-08-30:

- Plan of record: [`OpenCoven/chat/docs/superpowers/plans/2026-08-15-phase-7-release-rollout.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-7-release-rollout.md) (read via the GitHub contents API).
- Program register: [`OpenCoven/chat/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md) (same method).
- Tracker issues in `OpenCoven/coven-cave`: `gh search issues "<bead-id>" --repo OpenCoven/coven-cave`, then direct issue/event/comment reads.
- `OpenCoven/coven-cave` `origin/main` at `dacbe6173b0657131c904539ebafa8ebee19469d` (tree inspected locally).
- Default branches of `OpenCoven/chat`, `OpenCoven/sdk`, and `OpenCoven/coven` via the contents API.

Limits of this verification, stated so the tables below are not over-read:

- **Beads is authoritative but was not readable here.** Per the register, the Beads database is the source of truth; the live store is the Dolt database (`refs/dolt/data`), and this environment has no `bd`/`dolt` CLI. The `.beads/issues.jsonl` tracked on `main` is a stale four-line July pilot export, not the program graph. Bead states below are therefore verified from the GitHub mirror cards and dated evidence comments — the method issue #4820 itself prescribes — not from the Beads DB.
- **Repository probes read each repo's default branch only.** Work on unmerged branches would not appear.
- **A missing mirror card is not a closed bead.** Several program beads have no GitHub mirror at all (see the coverage note below); for those, state is *unverifiable from the tracker*, which is not the same as closed.

## Phase 7 beads per the plan of record and the register

The plan's "Bead Mapping" table defines eight Phase 7 rows (one epic, five feature/task rows, two release rows). The program register's Phase 7 index lists six beads. The register is the authoritative bead enumeration; the plan rows with no distinct bead id correspond to work inside `cave-mbekl` (its Cave and Coven rows) and `cave-udcn7` (its two release rows). Both enumerations are reproduced so the mapping is checkable rather than assumed.

Plan Bead Mapping (`2026-08-15-phase-7-release-rollout.md`):

| Plan row | Type | Labels |
|---|---|---|
| Phase 7: Packaging, compatibility, publishing, and production rollout | epic | `program:chat-v1,phase:7,cross-repo` |
| Cave: publish Client v1 compatibility release | feature | `repo:coven-cave,phase:7,release,compatibility` |
| Coven: package and publish owner-adjacent daemon client crate | feature | `repo:coven,phase:7,rust-sdk,cratesio` |
| SDK: publish provenance packages, dev CLI, docs, and compatibility manifest | feature | `repo:sdk,phase:7,npm,provenance` |
| Chat: add verified cross-platform installers and updater metadata | feature | `repo:chat,phase:7,tauri,signing` |
| Cross-repository: add minimum/latest/main compatibility canaries | task | `cross-repo,phase:7,compatibility,canary` |
| Release: execute three-OS acceptance and rollback rehearsal | task | `cross-repo,phase:7,acceptance,rollback` |
| Release: stage OpenCoven Chat production rollout | task | `repo:chat,phase:7,production,rollout` |

Register Phase 7 index (`2026-08-15-opencoven-chat-program-tracking.md`):

| Bead | Owner | Work |
|---|---|---|
| `cave-j65ie` | Cross-repo (tracker) | Phase 7 epic |
| `cave-mbekl` | Cave/Coven | Authority compatibility releases |
| `cave-gcb0i` | Chat | Signed packages and updater |
| `cave-563z7` | SDK | npm packages, Rust crates, CLI, and docs |
| `cave-as76u` | Cross-repo | Authority-main and compatibility canaries |
| `cave-udcn7` | Cross-repo | OS acceptance, staged rollout, and rollback |
| `cave-ilh1h` | Cross-repo | Production v1 gate |

The plan also depends on earlier phases ("Depends on: Phase 6 full hardening and artifact privacy gates") and lists five external release prerequisites (Windows code-signing certificate/secrets, npm trusted publishers for the five `@opencoven/*` packages, crates.io publishing authority for both crates, macOS signing/notarization/updater secrets, and selection of the minimum supported Cave and Coven releases).

## Per-bead verified status (2026-08-30)

| Bead | Owner repo(s) | Tracker issue | Verified state | Evidence (dated) | What remains |
|---|---|---|---|---|---|
| `cave-j65ie` | coven-cave (tracker) | [#4778](https://github.com/OpenCoven/coven-cave/issues/4778), [#4820](https://github.com/OpenCoven/coven-cave/issues/4820) | **Open** (no completion evidence) | #4778 closed 2026-08-21T07:24:34Z by BunsDev as an "[a]ccidental repository-issue conversion", not a completion; re-mirrored as #4820 (created 2026-08-21T20:48:22Z), open with zero comments | Epic closes only when every Phase 7 bead and the gate close |
| `cave-mbekl` | Cave, Coven | none found | **Unverifiable from the tracker** (no mirror card; searches 2026-08-30 return only body references in #4777/#4778) | No mirror card in either mirror wave (2026-08-21 ~#4774–4781; 2026-08-21/22 #4818–4841). Cave-side Task 1/2 metadata work landed under a separate bead (see `cave-0wg` below), but no compatibility *release* of Cave or Coven is evidenced | Confirm bead state in Beads; a Cave Client v1 compatibility release and a Coven compatibility release remain unevidenced |
| `cave-gcb0i` | Chat | [#4776](https://github.com/OpenCoven/coven-cave/issues/4776) | **Closed as accidental — not completion evidence** | Closed 2026-08-21T07:24:29Z by BunsDev: "Closing this accidental repository-issue conversion…" Creation-time bead snapshot in the body: status open, P0, `needs-human`, deps `cave-b6wsl` + `cave-j65ie`. Default-branch probe of `OpenCoven/chat` (2026-08-30): `scripts/verify-package.mjs`, `scripts/release-context.mjs`, `.github/workflows/release.yml`, `docs/releasing.md`, `docs/rollback.md` all absent | Entire signed-package chain (Tasks 3–5): package verification, compatibility CI, signed release workflow, `docs/releasing.md`/`docs/rollback.md`; plus the human signing prerequisites |
| `cave-563z7` | SDK | none found | **Unverifiable from the tracker** | Default-branch probe of `OpenCoven/sdk` (2026-08-30): `compatibility/manifest.json`, `.github/workflows/authority-canary.yml`, `docs/pairing.md`, `docs/migration.md` absent; `release.yml` and `scripts/verify-package.mjs` exist but may predate Phase 7 | Bead-state confirmation from Beads; Tasks 8–10 evidence (manifest, provenance publishing, dev CLI docs) unevidenced on the default branch |
| `cave-as76u` | Cross-repo | none found | **Unverifiable from the tracker** | No canary workflow found on either default branch probed 2026-08-30 (chat `compatibility-canary.yml` absent; sdk `authority-canary.yml` absent) | Bead-state confirmation; canary implementation and scheduled runs |
| `cave-udcn7` | Cross-repo | [#4781](https://github.com/OpenCoven/coven-cave/issues/4781) | **Open** — closed as accidental 2026-08-21T07:24:41Z, **reopened** 2026-08-22T04:14:03Z by CompleteDotTech | Reopen comment records: unblocked by `cave-0wg` closing (PR [#4785](https://github.com/OpenCoven/coven-cave/pull/4785) merged 2026-08-21T18:19:43Z as `96627be5a`); this issue's own tooling shipped via PR [#4789](https://github.com/OpenCoven/coven-cave/pull/4789) merged 2026-08-21T21:16:35Z as `df5c72aac` (`scripts/release-acceptance.mjs`, `scripts/release-rollout.mjs`, 56 tests, `docs/workflows/{release-acceptance,production-rollout}.md`), composing with #4782's rollback-readiness gate | The three-OS acceptance journey is human execution: a validated record must land in `docs/release-acceptance-results/` (only `.gitkeep` exists on `origin/main` `dacbe6173`); global `opencoven` doctor/pair/session/send/tail/scaffold acceptance; staged rollout with a rollback drill and prior stable artifacts verified first |
| `cave-ilh1h` (gate) | Cross-repo (tracker) | [#4777](https://github.com/OpenCoven/coven-cave/issues/4777) | **Closed as accidental — no gate evidence recorded** | Closed 2026-08-21T07:24:32Z by BunsDev with the accidental-conversion comment; no commands or artifacts recorded on the mirror. PR [#4782](https://github.com/OpenCoven/coven-cave/pull/4782) ("Gate rollout on a verified rollback target (cave-ilh1h)", merged 2026-08-21T20:36:29Z as `a63e859c1`) landed gate-*referencing tooling* (`scripts/release-rollback-readiness.*`, `docs/workflows/release-rollback-readiness.md`), not a gate record | Gate execution after all Phase 7 beads close, with a record of passing commands and artifacts (contrast: the Phase 2 gate record exists at `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`) |

### Additional Phase 7 execution beads found outside the register table

| Bead | State | Evidence |
|---|---|---|
| `cave-0wg` — Phase 7 Task 1 (client-v1 release compatibility metadata) | **Closed** (per the #4781 reopen comment) | PR [#4785](https://github.com/OpenCoven/coven-cave/pull/4785) merged 2026-08-21T18:19:43Z as `96627be5a`; `scripts/client-v1-release-smoke.mjs` and `.test.mjs` verified present on `origin/main` `dacbe6173` on 2026-08-30. No dedicated mirror issue |
| `cave-7yo` — reconciliation, phase1a/cave-pairing-authority | **Open** | Per the #4781 reopen comment (2026-08-22): branch unchanged at `287497dd3` with no PR, carries a competing `src/app/api/client/v1/health/route.ts`; the 10-file collision with merged #4785 is unresolved and falls on whoever lands phase1a. Directly touches the Phase 7 Task 1 surface |

## Cave-side Phase 7 artifacts on `coven-cave` `origin/main` (`dacbe6173`, verified 2026-08-30)

Present: `scripts/client-v1-release-smoke.mjs` + `.test.mjs` (#4785); `scripts/release-rollback-readiness.mjs` + `.test.mjs`, `docs/workflows/release-rollback-readiness.md` (#4782); `scripts/release-acceptance.mjs` + `.test.mjs`, `scripts/release-rollout.mjs` + `.test.mjs`, `docs/workflows/release-acceptance.md`, `docs/workflows/production-rollout.md` (#4789); `docs/release-acceptance-results/.gitkeep`.

Absent: any validated acceptance record in `docs/release-acceptance-results/`.

## Owner-repository probes (default branches, 2026-08-30)

| Path | Chat | SDK | Coven |
|---|---|---|---|
| `compatibility/manifest.json` | — | **absent** | — |
| `.github/workflows/release.yml` | **absent** | present (provenance unknown; may predate Phase 7) | — |
| `.github/workflows/compatibility-canary.yml` | **absent** | — | — |
| `.github/workflows/authority-canary.yml` | — | **absent** | — |
| `.github/workflows/release-crates.yml` | — | — | **absent** |
| `docs/releasing.md`, `docs/rollback.md` | **absent** | — | — |
| `docs/release-acceptance.md`, `docs/production-rollout.md` | **absent** | — | — |
| `docs/pairing.md`, `docs/migration.md` | — | **absent** | — |
| `docs/reference/coven-client-crate.md` | — | — | **absent** |
| `scripts/verify-package.mjs` | **absent** | exists (provenance unknown) | — |
| `scripts/release-context.mjs` | **absent** | — | — |
| `scripts/verify-coven-client-package.mjs` | — | — | **absent** |
| `crates/coven-client/` packaging (README, `tests/package_contract.rs`) | — | — | **absent** |
| `src-tauri/tauri.conf.json` | exists (Phase 7 package assertions unverified) | — | — |

Chat `ci.yml` exists. These probes read default branches only and cannot rule out branch-level Phase 7 work.

## Verdict against issue #4820 acceptance criteria

**Criterion 1 — "All Phase 7 implementation and verification beads are closed": NOT satisfied (false on the verifiable record).**

- Two Phase 7 mirror issues are open as of 2026-08-30: [#4820](https://github.com/OpenCoven/coven-cave/issues/4820) (epic `cave-j65ie`) and [#4781](https://github.com/OpenCoven/coven-cave/issues/4781) (`cave-udcn7` — reopened 2026-08-22 with the remaining human-executed acceptance journey named explicitly).
- The only Phase 7 mirror issues in a closed state (#4776, #4777, #4778) were all closed within one minute on 2026-08-21T07:24:2x–3xZ by BunsDev, each with the same comment: "Closing this accidental repository-issue conversion. The canonical task remains the Bead mirrored as a draft card on the Teamwork project; Beads remains the source of truth." These are not completion closures and carry no completion evidence.
- Three Phase 7 beads (`cave-mbekl`, `cave-563z7`, `cave-as76u`) have no tracker issue at all; their state cannot be verified from the tracker, and unverifiable is not closed.
- The one Phase 7 execution bead verifiably closed is `cave-0wg` (PR #4785), evidenced inside the #4781 reopen comment.

**Criterion 2 — "The Phase 7 gate records passing commands and artifacts": NOT satisfied (false on the verifiable record).**

- The gate's only mirror ([#4777](https://github.com/OpenCoven/coven-cave/issues/4777)) records no commands and no artifacts — only the accidental-closure comment.
- No Phase 7 gate record document exists in `coven-cave` (contrast the Phase 2 gate record `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`, landed by PR #4951).
- What has landed is necessary-but-insufficient: Cave-side Phase 7 Task 1 evidence (PR #4785, `cave-0wg` closed) and gate-referencing rollout/rollback/acceptance tooling (PRs #4782, #4789). Gate-referencing tooling is not a gate record.

## Dependency chain from earlier phases that gates Phase 7 execution

Per the register: each phase gate is blocked by its implementation and conformance beads, and the next phase's implementation beads are blocked by the preceding gate. The plan states Phase 7 "Depends on: Phase 6 full hardening and artifact privacy gates," and its bead mapping hangs every Phase 7 row off "Phase 6 full gate" (directly or via the Cave candidate). Merge order item 1 is "Cave and Coven compatibility/release tooling."

| Earlier gate | Bead | Tracker issue | Verified state 2026-08-30 |
|---|---|---|---|
| Phase 0 gate | `cave-bt9wx` | none found | No closure evidence verifiable from the tracker |
| Phase 1 gate | `cave-23nmv` | [#4833](https://github.com/OpenCoven/coven-cave/issues/4833) | **Open**, zero comments, no evidence |
| Phase 2 gate | `cave-8ywi2` | [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) | **Open** — executed gate verdict 2026-08-23T19:54:17Z: "does NOT pass. Cave's half does." Record: `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md` (PR [#4951](https://github.com/OpenCoven/coven-cave/pull/4951), squash `dbf90753f`); post-merge mutation verification 2026-08-23T21:19:32Z found the gate sound with one named hole. Duplicate mirror [#4906](https://github.com/OpenCoven/coven-cave/issues/4906) closed as duplicate 2026-08-24T12:26:44Z |
| Phase 3 gate | `cave-e1kfa` | none found | No closure evidence verifiable from the tracker |
| Phase 4 gate | `cave-gylsl` | none found | No closure evidence verifiable from the tracker |
| Phase 5 gate | `cave-rbikx` | none found | No closure evidence verifiable from the tracker |
| Phase 6 gate | `cave-b6wsl` | none found | No closure evidence verifiable from the tracker; directly blocks `cave-gcb0i` per its bead metadata |

Open earlier-phase implementation mirrors (from the same 2026-08-30 sweep): Phase 1 — [#4818](https://github.com/OpenCoven/coven-cave/issues/4818) (`cave-9pifu`), [#4780](https://github.com/OpenCoven/coven-cave/issues/4780) (`cave-p8qkk`), [#4830](https://github.com/OpenCoven/coven-cave/issues/4830) (`cave-tsvfj`); Phase 2 — [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) (`cave-ff3j6`, Chat), [#4838](https://github.com/OpenCoven/coven-cave/issues/4838) (`cave-hjy2f`, Cross-repo — Cave third recorded, SDK and Chat thirds outstanding), and `cave-3yax4` (#4836, SDK — pull-only repository, needs a fork PR, per the Phase 2 gate record). Phase 2's own gate record states the blocking condition plainly: two of its three open beads live in repositories the gate's owner does not own.

**Consequence for Phase 7.** The verifiable chain is incomplete: the Phase 6 gate that `cave-gcb0i` depends on has no closure evidence anywhere in the tracker, the Phase 2 gate is open with an executed failing verdict, and Phase 1's gate mirror is open with no evidence. Additionally, `cave-7yo` leaves an unresolved 10-file collision on `src/app/api/client/v1/health/route.ts` — the exact surface Phase 7 Task 1 shipped (#4785) — waiting on whoever lands `phase1a/cave-pairing-authority`. The plan's five external release prerequisites (signing certificates and secrets, npm trusted publishers, crates.io authority, minimum supported Cave/Coven release selection) have no recorded evidence either, and the beads that need them carry `needs-human`. No blocker to *planning* Phase 7 exists — the tracker shows tooling for it already landing — but no verifiable record shows Phase 7 execution unblocked end to end.

## Coverage note

Two mirror waves (2026-08-21 ~#4774–4781 and 2026-08-21/22 #4818–4841) created tracker cards for some program beads only. Cards exist for `cave-j65ie` (twice), `cave-gcb0i`, `cave-ilh1h`, and `cave-udcn7`; none exist for `cave-mbekl`, `cave-563z7`, `cave-as76u`, or the Phase 0/3/4/5/6 gates. This gap is a verification finding, not a status claim about those beads.

## Summary

Phase 7 is **planned and partially started, not done**. Verifiable progress: `cave-0wg` closed with merged Cave-side compatibility-metadata tooling (PR #4785), and `cave-udcn7`'s tooling landed (PRs #4782, #4789) while its human acceptance journey remains open with its evidence directory empty. Neither acceptance criterion of issue #4820 is met on the verifiable record: Phase 7 beads are not all closed (two mirrors open, three beads unverifiable, the only closures accidental), and the Phase 7 gate has recorded no commands and no artifacts. This document records that state and closes nothing.
