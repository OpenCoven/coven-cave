# Chat v1 Phase 7 — OS acceptance, staged rollout, and rollback drill: verified status + acceptance evidence runbook

Bead `cave-udcn7` (issue [#4781](https://github.com/OpenCoven/coven-cave/issues/4781)), Phase 7, P0, lane `release-acceptance`.

**Verification date: 2026-08-30.** Everything under "Verified" below was checked against live state on that date unless a date is attached to the specific claim. Verifier: agent session authenticated as `CompleteDotTech` (push access to OpenCoven/coven-cave only; `OpenCoven/chat`, `OpenCoven/sdk`, and `OpenCoven/coven` were read as read-only sources).

**Verdict up front: rollout cannot begin, and the acceptance journey cannot be executed to completion from this environment.** The dependency situation is unverified-to-unsatisfiable, no Chat v1.0.0 candidate exists to accept, and the human-host constraint below stands. What *can* be verified from this Linux host — the rollout/rollback/acceptance evidence machinery against the live Cave release line — **was** verified today, and the results are recorded here.

---

## 1. Verified dependency state (read-only, 2026-08-30)

| Bead | Tracker card (coven-cave) | Owner-repo implementation state (verified 2026-08-30) | Verdict for `cave-udcn7` |
| --- | --- | --- | --- |
| `cave-as76u` | **No mirror card found anywhere.** Search of all OpenCoven/coven-cave issues and PRs finds `cave-as76u` only inside the dependency lists of #4777, #4778, #4781. All 41 OpenCoven/chat issues were listed and contain no `coven-bead-id:` cards at all. The string appears nowhere in the coven-cave clone. | Unverifiable, because the bead's identity is only in the Beads DB, which is not readable from this environment (no `bd` or `dolt` CLI installed; the passive `.beads/issues.jsonl` export in this clone is stale at 4 rows containing only `cave-hlv`; `refs/dolt/data` exists on `origin` but Dolt table storage needs a dolt binary). **Derived:** by position in the dependency graph and the plan's Bead Mapping table, the best-fit candidate is the "Cave: publish Client v1 compatibility release" row — the Cave-side compatibility release the acceptance journey depends on. That *implementation* is verifiably landed: client-v1 compatibility metadata shipped in PR [#4785](https://github.com/OpenCoven/coven-cave/pull/4785) (squash-merged 2026-08-21T18:19:43Z as `96627be5a`; `scripts/client-v1-release-smoke.{mjs,test.mjs}` and the contract fixture are present on `main`), and Cave publishes releases through the full Client v1 line (latest **v0.3.12**, 2026-08-28, with signed installers for all three OSes). **The identification is derived and unconfirmed; the implementation state is verified.** | **Not verifiable as a tracker card; the work it most plausibly names is landed in coven-cave.** Beads remains the source of truth and must reconcile the missing card. |
| `cave-j65ie` | Phase 7 epic tracker. Mirror cards: **#4778** (created 2026-08-21T06:16:19Z, CLOSED 2026-08-21T07:24:34Z by `BunsDev` — closed as an "accidental repository-issue conversion", seconds before the reopen comment on #4781) and **#4820** (created 2026-08-21T20:48:22Z, **OPEN** — the re-mirror, with its dependency list stripped). | Epic-level: "All Phase 7 implementation and verification beads are closed" + "the Phase 7 gate records passing commands and artifacts". Owner-repo state today: **Chat repo has zero releases and zero tags**; none of the plan's Task 12/13 deliverable files exist there (`docs/releasing.md`, `docs/rollback.md`, `docs/production-rollout.md`, `docs/release-acceptance.md`, `scripts/verify-package.mjs` are all 404 on `OpenCoven/chat@main`, verified 2026-08-30); only `ci.yml`/`ci-image.yml` workflows exist (no release or compatibility/authority canary workflows). **SDK repo:** packages/{core,cave,coven,sdk,cli} exist and `@opencoven/dev-cli` maps the `opencoven` bin, but there is no `compatibility/manifest.json`, no release tags, and every `@opencoven/*` package returns 404 on registry.npmjs.org (checked 2026-08-30). **Coven repo:** `crates/coven-client` exists but is still named `coven-client` 0.1.0 (the plan's publish-time name is `opencoven-coven-client`); crates.io reports both `opencoven-cave-client` and `opencoven-coven-client` as nonexistent. **Coven-cave (Cave) repo:** the one place Phase 7 machinery is substantially landed (see §3). | **Open — not satisfied.** Its own acceptance criteria are not met, and the artifacts the acceptance journey consumes (signed Chat v1 installers, published npm/crate packages) do not exist yet. |

**Consequence for this issue:** both dependencies resolve to *not satisfied for rollout purposes*. A tracker card being open is not by itself a hard blocker, but the concrete artifacts its closure stands for — signed Chat v1.0.0 installers, published `@opencoven/*` npm packages, published owner-adjacent crates — are prerequisites for the no-source-checkout journey, and none of them exist as of 2026-08-30.

## 2. The honest execution constraint

The full no-source-checkout acceptance journey **requires human-run macOS and Windows hosts and is not executable in this Linux environment.** The journey's own definition (`docs/workflows/release-acceptance.md`, landed by PR #4789) states why: it installs published, signed artifacts on real machines with no developer tooling present, and "a CI runner with a source checkout cannot stand in for it." This host additionally has no desktop session, so even the Linux leg of the *app* journey cannot run here.

**Exactly which Linux portions are executable here — and were executed today (2026-08-30):**

| Executable here | Evidence produced today |
| --- | --- |
| The evidence tooling itself: `release:acceptance steps / template / validate` and `release:rollout stages / gate / restore-plan` (all run with plain `node`, zero dependencies) | `steps` lists all 19 journey steps; a fresh template validates as `incomplete` with every step `pending` (the correct pre-execution state); a drill state file gates to `decision: advance` at `stable-5` (exit 0); `restore-plan` prints the bounded three-step drill |
| Live updater-chain verification of the prior stable: `node scripts/verify-release-updater.mjs` | **PASS** — endpoint resolves, pubkey `ab97b0f03eb6dbea` present, `latest.json` v0.3.12 serves all four platforms (`darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `windows-x86_64`) with **valid signatures**, and `latest.json` 0.3.12 == release v0.3.12 |
| Rollback-readiness verdict for the current stable line: `node scripts/release-rollback-readiness.mjs` | **`ready=true`**, baseline `v0.3.11`, all four updater platforms covered, nothing missing (`baseline-waived=false`) |
| Release-asset inventory of the rollback-capable current stable | Cave **v0.3.12** (published 2026-08-28) ships `.dmg`/`.msi`/`.AppImage` for both darwin arches + win + linux, each with a `.sig`, plus `SHA256SUMS` and `latest.json` |

**What is not executable here:** every step of the journey itself — installing signed installers, pairing through the desktop UI, sending, resuming, restarting, attachments, actions, revoke, update migration — because it requires a real desktop session with no source checkout; and the global `opencoven` CLI steps, because `@opencoven/dev-cli` is not published (registry 404), so `cli-install` has nothing to install. The Linux run in the acceptance record therefore cannot be produced here either; it needs a human at a Linux desktop the same way macOS and Windows need humans. The only honest Linux contribution this environment makes is the tooling verification above.

## 3. What the plan of record already defines (verified read-only, 2026-08-30)

Plan of record: `OpenCoven/chat/docs/superpowers/plans/2026-08-15-phase-7-release-rollout.md` (659 lines at `main`, fetched 2026-08-30). It defines the journey (Task 12) and the rollout staging (Task 13); the machine-checkable numbers landed in this repo via PRs #4782 and #4789 (`docs/workflows/release-acceptance.md`, `production-rollout.md`, `release-rollback-readiness.md`, `scripts/release-{acceptance,rollout,rollback-readiness}.mjs`).

**What the plan itself states** (Tasks 12–13, quoted to threshold level):

- Track **crash-free launches, pairing success, read/send/resume/restart/revoke canaries, duplicate-send count, and data-integrity failures**; *any* auth, duplicate-send, or data-integrity regression pauses rollout.
- Stages: maintainer-only and private beta at 0% with manual update checks only, then **low-percentage stable** metadata, expanding **only after the approved canaries remain green for the documented observation window**.
- Rollback drill: restore prior stable updater metadata **without moving tags or overwriting artifacts**; npm packages may be deprecated and a patch-forward installed without changing Cave or Coven authority state.
- Acceptance recording: OS, versions, artifact checksums, result, diagnostic IDs, sanitized notes — in the release issue or approved evidence system; never credentials or private prompts.

**The numeric values and stage table are not in the plan doc — they landed in this repo's `docs/workflows/production-rollout.md`** (Task 13's implementation). They are cited here because they are the operative definition the gate enforces:

| Stage | Audience | Distribution | Minimum observation |
| --- | ---: | --- | ---: |
| `maintainer` | 0% | manual check only | 24h |
| `private-beta` | 0% | manual check only | 48h |
| `stable-5` | 5% | automatic | 24h |
| `stable-25` | 25% | automatic | 48h |
| `stable-100` | 100% | automatic | — |

Defaults (`thresholds` in `scripts/release-rollout.mjs`, documented in `production-rollout.md`): `minCrashFreeLaunchRate` 0.995, `minPairingSuccessRate` 0.98, `maxDuplicateSends` 0, `maxDataIntegrityFailures` 0.

## 4. Acceptance evidence runbook

The journey step ids below are the canonical ids `scripts/release-acceptance.mjs` validates; the issue's ten journey words map onto them as shown. The *behavior* of each step is specified in `docs/workflows/release-acceptance.md` (do not duplicate it here); this runbook adds the **evidence artifact** each step must produce to count, per OS. Everything marked **derived** is this runbook's specification, not plan text — the plan and the landed workflow docs define *what* is run and validated, not which artifact captures each step.

**Record mechanics (from the landed validator — not derived):** one JSON record per OS at `docs/release-acceptance-results/<tag>.json`, keys exactly `macos`/`windows`/`linux`, each OS exactly once; every step takes `pending`/`pass`/`blocked`/`fail`; `blocked` and `fail` owe a `diagnosticId`; all fields are JSON strings (no coercion); candidate commit is 40-hex and every artifact digest is 64-hex; the validator must report `complete` before rollout's gate accepts the `acceptance` verdict. Screenshots and raw logs are **not** part of the schema — they attach to the release issue / approved evidence system, sanitized, referenced by `diagnosticId` and `notes` (the plan's Task 12 Step 4 instruction).

### 4.1 Journey-step evidence matrix (each of macOS / Windows / Linux)

| Issue step | Canonical step id(s) | Evidence that must be captured | Regression class it feeds |
| --- | --- | --- | --- |
| install | `install-cave`, `install-chat` | Exit code of the installer run; screenshot of the installed app first-launch; the **exact installer filename + its SHA-256** recorded in `artifacts[]` (the bytes accepted — a rollout shipping different bytes is not accepted). *(Derived)* macOS: Gatekeeper identifies the signed/notarized app; Windows: MSI completes with no unsigned-driver prompt; Linux: AppImage launches from a clean `$HOME` cache. | `crash` (a crash at install/first-launch counts against crash-free launches) |
| pair | `discover-cave`, `pair-approve` | Screenshot of Cave's approval dialog; the pairing grant id from Cave's client list; Chat's post-pair connected state. Exit code of the pairing action if scriptable. | `auth` (pairing success rate) |
| read | `load-lists` | Screenshot of familiar + conversation lists populated from the paired authority; conversation id of the test conversation (reused by later steps). | functional canary `read` |
| send | `create-send` | Screenshot of the sent message rendered; message id + send timestamp (needed later to prove *no duplicates*); send succeeded exactly once. | functional canary `send`; `duplicate-send` (any second copy of the same message id is a hard stop) |
| resume | `disconnect-resume` | Timestamped evidence of the disconnect (network dropped / app backgrounded), then the resumed session showing **no message loss**; the conversation's message list before and after. | functional canary `resume`; `data-integrity` (gap or reorder is a failure) |
| restart | `restart-history` | Both processes' restart logs (or OS process-exit + relaunch evidence) and the canonical history screenshot proving the post-restart list equals the pre-restart list message-for-message. | functional canary `restart`; `data-integrity`; `crash` |
| attachment | `attachment` | The uploaded file's id/URL as shown in the conversation; screenshot of the re-opened attachment rendering; file size + digest if the UI exposes them. | `data-integrity` |
| action | `safe-action` | The action's run record in the **test repository** (issue/comment/branch id), and the confirmation Chat displayed. Only a designated test repository counts. | `data-integrity` (an action landing in the wrong repo or twice) |
| revoke | `revoke-pairing` | Screenshot of Cave showing the client revoked; Chat returned to the pairing screen; **the next read returns 401** — capture the API error surface shown. | functional canary `revoke`; `auth` |
| update | `update-migration` | Updater prompt screenshot; post-update "About" version; proof the preference/keychain/cache state survived (a preference visibly persisted + a migrated keychain entry); updater log line. | `crash`, `data-integrity` |

**OS-specific capture notes** (all **derived**): macOS — crash evidence from Console.app / `~/Library/Logs/DiagnosticReports`, keychain access prompts recorded for `update-migration`. Windows — Event Viewer Application log + `%TEMP%` MSI logs for install/crash evidence; `%APPDATA%`/registry-backed preferences for migration. Linux — AppImage launch from a clean `$HOME`, `~/.config` paths for cache migration, journalctl for crash evidence.

### 4.2 Global CLI acceptance (`@opencoven/dev-cli` → `opencoven`)

Plan wording (Task 12 step 13): install the CLI, run doctor, inspect Coven sessions, send/tail a test conversation, execute every scaffold. Canonical step ids: `cli-install`, `cli-doctor`, `cli-pair`, `cli-session`, `cli-send`, `cli-tail`, `cli-scaffold`.

Evidence per step (**derived**, consistent with the app-step rule above): the CLI's own stdout captured to a log per step **plus its exit code** — the CLI is the one journey surface where exit codes are first-class evidence; `cli-doctor` additionally captures the doctor report's verdict lines; `cli-pair` records the pairing grant id it created; `cli-send`/`cli-tail` record the message id and prove the tailed output contains it exactly once (this is the duplicate-send canary on the CLI path); `cli-session` records the session ids it listed; `cli-scaffold` records one line per scaffold executed with its exit code. Same four-result semantics and `diagnosticId` requirement as the app steps.

### 4.3 Conditions that stop rollout (from `production-rollout.md` / `release-rollout.mjs` — plan-defined, numbers landed)

**`rollback`** (the candidate must not be, or must cease to be, the served update):

- crash-free launch rate **below 0.995**
- pairing success rate **below 0.98**
- **any** duplicate send at all
- **any** data-integrity failure at all
- …or an operator/monitor-reported regression in those classes, or a failed step in the acceptance record.

**`hold`** (stay at the stage; what shipped stays shipped): unmet observation window; a failing functional canary (`read`, `send`, `resume`, `restart`, `revoke`); acceptance merely `incomplete`; rollback readiness unproven; a regression whose class is unrecognized; **a metric nobody measured — absent data holds, it never advances and never rolls back**.

The duplicate-send and data-integrity thresholds are zero because there is no acceptable rate for either. `rollback` outranks `hold` when both apply.

### 4.4 Rollback-drill evidence checklist

**Prior stable artifacts (verified before rollout begins)** — for the baseline release (`release-rollback-readiness.mjs` resolves it as the newest published release strictly below the candidate, skipping drafts/prereleases/non-`vMAJOR.MINOR.PATCH` tags):

- [ ] Every baseline installer present for all supported OSes: `.dmg` (both arches), `.msi`, `.AppImage` — verifiable today against **v0.3.12**, which ships all of them
- [ ] `SHA256SUMS` present on the baseline release — a rollback artifact gets checked before it is run
- [ ] Baseline `latest.json` version == baseline tag, with every `platforms{}` entry carrying both `url` and `signature`, and every url resolving to a live asset on that same release
- [ ] Cave Client v1 conformance evidence for the prior stable exists (prior records: `docs/client-v1-conformance-results/2026-08-22-v0.3.9-win32*.json`, `2026-08-23-*-cave-*.json`)

**Rollback metadata verification (commands run today, all green):**

```bash
# 1. Prior-stable artifacts + rollback metadata (the gate the release workflow runs):
RELEASE_TAG=v0.3.12 GITHUB_REPOSITORY=OpenCoven/coven-cave GITHUB_TOKEN="$(gh auth token)" \
  GITHUB_OUTPUT=/tmp/rr-output.txt GITHUB_STEP_SUMMARY=/tmp/rr-summary.md \
  node scripts/release-rollback-readiness.mjs          # → ready=true, baseline v0.3.11, 4/4 platforms

# 2. Updater chain end-to-end (endpoint → manifest → per-platform signatures):
node scripts/verify-release-updater.mjs                # → RESULT: PASS (2026-08-30)

# 3. The drill itself, without running it (prints the bounded 3-step plan):
node scripts/release-rollout.mjs restore-plan <state-file>
```

**The drill itself (bounded, three steps, one mutation — from `production-rollout.md`):**

1. `verify-baseline-artifacts` — every asset the baseline manifest references is present and signature-valid (writes nothing)
2. `republish-baseline-manifest` — baseline manifest uploaded as `latest.json` on the release the updater endpoint resolves to (metadata only)
3. `verify-updater-chain` — `pnpm release:verify-updater`; **expect exactly one ✗**: `version drift: latest.json=<baseline> vs release=<candidate>` — that line **is** the rollback; any *other* ✗ means the restore did not take

Evidence the drill itself must leave: the `restore-plan` output, the `make_latest` patch call result (step 1 of "Rolling back"), the `verify-release-updater` output **including** the expected drift line, and the incident note stating that moved installs need manual reinstall from baseline installers checked against `SHA256SUMS` (the updater never downgrades). **What rollback never does:** move a signed tag, overwrite a published artifact, unpublish a version, or re-sign a published artifact — `assertBoundedRestore()` refuses any plan containing them.

## 5. Status summary

| Gate | State (2026-08-30) |
| --- | --- |
| Dependency `cave-j65ie` | Open — Chat v1 signed artifacts and published SDK/CLI packages do not exist |
| Dependency `cave-as76u` | No mirror card to verify against; plan-derived identification unconfirmed |
| Acceptance journey (macOS/Windows/Linux) | Not executed — `docs/release-acceptance-results/` holds no record; requires human hosts |
| Global CLI acceptance | Not executable today — `@opencoven/dev-cli` unpublished |
| Evidence tooling (Linux) | **Verified working today** (§2 table) |
| Prior stable + rollback metadata | **Verified today** — v0.3.11 rollback-ready 4/4 platforms; updater chain PASS |
| Rollout gate | Correctly holds: no candidate exists to gate |

The verified, dated state of the two dependency beads is: **`cave-j65ie` open (tracker #4820; #4778 closed as an accidental conversion), `cave-as76u` without any visible tracker card while its implementation surface (Cave Client v1 compatibility release) is landed on `main`.** Neither dependency's acceptance criteria are met; the acceptance journey this issue exists to execute needs the missing Chat v1 artifacts and human operators on macOS and Windows.
