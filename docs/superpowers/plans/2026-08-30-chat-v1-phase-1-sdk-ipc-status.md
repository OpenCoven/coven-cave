# [Chat v1 P1] TypeScript Coven IPC discovery and health — verified status + implementation contract handoff

**Date:** 2026-08-30 (all evidence below was fetched on this date)
**Bead:** `cave-p8qkk` · Phase 1 · P0 · lane `typescript-sdk-cli` · owner repo **OpenCoven/sdk**
**Issue:** [OpenCoven/coven-cave#4780](https://github.com/OpenCoven/coven-cave/issues/4780) (GitHub Teamwork visibility mirror; Beads is authoritative)
**Plan of record:** [`OpenCoven/chat/docs/superpowers/plans/2026-08-15-phase-1-discovery-pairing.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-1-discovery-pairing.md)
**Status doc scope:** verified state + handoff only. No code changes, no workflow changes, no edits to other status docs.

---

## 0. Verdict (TL;DR)

**The `coven.daemon.v1` SDK IPC lane this issue asks for is already implemented and merged on `OpenCoven/sdk` `main`.** Wave 1 landed 2026-08-22 as `feat: discover Coven daemon endpoints (#30)` and was hardened by later merges through 2026-08-29. All three deliverables and the fail-closed acceptance criteria have matching, test-covered code at the tip. What is **not** done is closure and verification bookkeeping: issue #4780 (the mirror), the Phase 1 epic (#4818 / `cave-fz01p`), and the Phase 1 gate (#4833 / `cave-23nmv`) are still open, and bead `cave-p8qkk` could not be reconciled from here because the authoritative Beads store is not reachable read-only.

Consequences for execution:

1. **No new feature PR appears to be required in `OpenCoven/sdk`.** The remaining work there is *verification against this contract* (§5.5 checklist) and any residual gap an owner confirms during that pass.
2. **The implementation cannot land from here regardless:** this session's token is authenticated as `CompleteDotTech`, and `gh api /repos/OpenCoven/sdk` returned `"push": false` (verified 2026-08-30). Only `OpenCoven/coven-cave` accepts pushes from this token.
3. The Phase 1 gate (`cave-23nmv`, issue #4833) still records "Cannot pass. No Phase 1 implementation exists on `main`" (dated 2026-08-22, the same day SDK #30 merged). That statement is true for the **cross-repo vertical slice** but predates the SDK Coven IPC merge; the gate should be reconciled against §2.

## 1. Verification method, reach, and limits (2026-08-30)

Read-only channels used:

- GitHub REST via `gh` (contents, commits, search, issue/PR lookups) as `CompleteDotTech`.
- A `--no-checkout` clone of `OpenCoven/coven-cave` at `main` tip `dacbe6173b0657131c904539ebafa8ebee19469d` (2026-08-30 03:59:22 -0500), grepped in the worktree.
- Full text of the plan of record, the approved spec, and the split SDK plan fetched from `OpenCoven/chat` (§6).

Limits found during verification (all recorded so nobody re-derives them):

- **GitHub code search is stale for this repo.** `gh api "search/code?q=repo:OpenCoven/sdk+coven.daemon.v1"` returned **0** results on 2026-08-30, as did related terms (`daemon ipc`, `COVEN_HOME`, `sqlite`) — yet the Contents API at the same tip shows `packages/coven/src/schemas.ts` line 1 exporting `COVEN_DAEMON_PROTOCOL = 'coven.daemon.v1'`. The Contents API reads the tip of `main` directly and is the authoritative signal; do not treat the 0-hit search as evidence of absence. Searches that came back 0 are still recorded in §2/§5.3 with this caveat.
- **Beads is authoritative but unreachable here.** Bead state lives in a local Dolt DB synced through `refs/dolt/data`; `.beads/issues.jsonl` is a passive export. The export in this clone (`dacbe617`, 2026-08-30) contains only four unrelated `cave-hlv*` dogfood rows, so `cave-p8qkk`/`cave-bt9wx`/`cave-fz01p` state could not be confirmed from Beads itself. GitHub mirror state is reported instead (§3).
- **No live runtime evidence.** Nothing here executed a Coven daemon, a real Unix socket, a Windows named pipe, or an OS keychain. SDK behavior is verified from source and test files on `main`, not from a live run. Windows-native runtime validation belongs to the release lane (per `OpenCoven/coven-cave` CI conventions and the SDK's packed/offline verification scripts).

## 2. OpenCoven/sdk — verified state (owner repo; **read-only for this token**)

Repo facts (REST API, 2026-08-30): `default_branch: main`, `pushed_at: 2026-08-30T09:30:16Z`, `permissions: {admin:false, maintain:false, push:false, pull:true}` → **no push access from this identity; execution must happen in `OpenCoven/sdk` itself.** Tip commit at fetch time: `4736bf2e0` 2026-08-29 `test(conformance): add cross-repository evidence contract (#73)`.

| Area | Verified state (2026-08-30) | Evidence |
|---|---|---|
| Repo layout | `packages/{cave,cli,core,coven,sdk}`, `tests/`, `conformance/`, `api-baselines/`, `docs/`, `examples/`, `scripts/`, pnpm workspace | `gh api /repos/OpenCoven/sdk/contents`, 2026-08-30 |
| Code search for `coven.daemon.v1` | **0 hits — stale index.** Contents API contradicts it (rows below). Treat search misses on this repo as unreliable. | `gh api "search/code?q=repo:OpenCoven/sdk+coven.daemon.v1"`, 2026-08-30 |
| Protocol constant | `packages/coven/src/schemas.ts`: `export const COVEN_DAEMON_PROTOCOL = 'coven.daemon.v1'`; `CovenHealthResponse { ok, apiVersion: typeof COVEN_DAEMON_PROTOCOL, covenVersion, capabilities }` | Contents API `packages/coven/src/schemas.ts`, 2026-08-30 |
| Deliverable 1: discovery | `packages/coven/src/discovery.ts`: `CovenDiscoverySource = 'coven_home' \| 'config_paths'`; runs exact `coven config paths --json` argv with a sanitized env allowlist (incl. `COVEN_HOME`); reads a bounded (16 KiB) daemon metadata record (`socket`, `pid`, `startedAt`, `processCreationTime`); freshness + `uid` owner checks; no-shell `execFile`; caller cannot override the Coven executable | Contents API + `tests/coven-discovery.spec.ts` test names (`prefers non-empty COVEN_HOME without invoking the CLI`, `falls back to exact no-shell config paths argv with a sanitized environment`, `does not allow callers to override the Coven executable`), 2026-08-30 |
| Deliverable 2: transports | `packages/coven/src/transport-unix.ts` and `transport-windows.ts` exist and implement validated same-user IPC; `packages/core/src/discovery.ts` defines the endpoint union `{ kind: 'http' \| 'unix' \| 'windowsNamedPipe' }` with `parseDiscoveryEndpoint` | Contents API, 2026-08-30 |
| Deliverable 3: `opencoven coven health` | `packages/cli/src/coven.ts` (`@opencoven/dev-cli`, private): builds a transport from the discovered endpoint and requires a transport-security provider — `peer_identity` (unix) / `pipe_ownership` (windows) — else fails closed with `platform_security_unavailable`; `packages/coven/src/client.ts` `health()` rejects when `response.apiVersion !== COVEN_DAEMON_PROTOCOL` | Contents API `packages/cli/src/coven.ts`, `packages/coven/src/client.ts`, 2026-08-30 |
| Structured daemon errors preserved | `transport-unix.ts`: `CovenDaemonResponseError` brand; bounded error-tree reconstruction (max depth 16, 1 024 nodes, 64 KiB strings); `SENSITIVE_FIELD_PATTERN` redaction; `CovenIpcError` codes `not_found`, `command_failed`, `malformed_config`, `unsafe_endpoint`, `owner_mismatch`, `connect_failure`, `timeout`, `body_limit`, `frame_limit`, `invalid_response` with `phase` diagnostics | Contents API `packages/coven/src/discovery.ts`, `transport-unix.ts`, 2026-08-30 |
| Forged-path / ownership fail-closed | Unix: `CovenUnixFileIdentity { device, inode, mode, ownerUid, symbolicLink, socket }` + `CovenUnixPeerIdentity { uid, gid, pid }`. Tests include `rejects unsafe discovered endpoint paths`, `rejects a reported Unix IPC path outside the reported Coven home`, `rejects copied Windows daemon metadata instead of following its socket`, `uses safe nonblocking flags and rejects a FIFO opened after lstat`, `rejects metadata path replacement after open and closes the handle`. Windows: `CovenWindowsPipeIdentity { ownerIdentity, ownerOnly, pipeIdentity }`; `validateIdentity` throws `unsafe` when `ownerOnly !== true` and `owner_mismatch` ("Coven named pipe owner did not match the current user.") on identity mismatch | Contents API `packages/coven/src/transport-unix.ts`, `transport-windows.ts`, `tests/coven-discovery.spec.ts`, 2026-08-30 |
| "Never reads Coven SQLite or daemon files directly" | Code search `repo:OpenCoven/sdk sqlite` → 0 (index-lag caveat as above); `packages/coven` is a private, `sideEffects:false` package whose discovery touches only the `coven config paths --json` output and the bounded daemon metadata file — the two sanctioned discovery channels from the plan; no SQLite client appears in the fetched sources. Boundary tests `tests/import-purity.spec.ts` and `tests/package-boundaries.spec.ts` exist on `main`. | Contents API + org code search, 2026-08-30 |
| Wave history | `3ab5b3132` 2026-08-22 `feat: discover Coven daemon endpoints (#30)` ← the Coven IPC lane; `a57ca8ea1` 2026-08-24 `feat: complete Cave pairing and secure credential custody (#54)`; `3d2e61f71` 2026-08-25 `build: freeze packed public API baselines (#64)` | `gh api "repos/OpenCoven/sdk/commits?path=packages/coven"`, 2026-08-30 |
| Conformance artifacts | `conformance/client-v1-cross-repository-assertions.json` + `client-v1-cross-repository-evidence.schema.json` | Contents API `conformance/`, 2026-08-30 |

Plan-1b conformance notes: the spec's and plan's other SDK obligations (`@opencoven/dev-cli` `doctor`/`discover`/`cave pair|status|forget`, `native-secret-store.ts` with `secure_store_unavailable`, no import-time I/O, packed-package verification) also have corresponding files/tests on `main` (`packages/cli/src/{doctor,discover,cave,coven,credentials,native-secret-store}.ts`, `tests/{discovery-contract,coven-discovery,cli-coven-security,native-secret-store,import-purity,public-contract,packed-package}.spec.ts`). Those lanes belong to `cave-lf7bu`, not this bead; they are listed only as boundary context.

## 3. Dependency beads — verified state (tracker mirrors; Beads authoritative, unreachable)

| Bead | Role | Tracker evidence (2026-08-30) | Implementation state |
|---|---|---|---|
| `cave-p8qkk.1` | This work item (child of `cave-p8qkk`) | Resolves to [#4780](https://github.com/OpenCoven/coven-cave/issues/4780) (open, updated 2026-08-24) — the issue body itself is the mirror of bead `cave-p8qkk` | Implemented on `OpenCoven/sdk` `main` since #30 (2026-08-22); see §2. Bead closure not verifiable from GitHub |
| `cave-bt9wx` | **Phase 0 gate** (per approved spec: "Depends on: Phase 0 gate `cave-bt9wx`") | **No tracker issue exists anywhere in the org** — org-wide search `cave-bt9wx is:issue` returns only #4780's dependency mention (verified 2026-08-30) | Unknown. Cannot be verified read-only from GitHub; requires `bd show cave-bt9wx` where the Beads Dolt DB is reachable |
| `cave-fz01p` | Phase 1 epic (program coordination) | [#4818](https://github.com/OpenCoven/coven-cave/issues/4818) "[Chat v1 P1] Discovery, pairing, health, and revocation" — open | Open by definition: it closes when all Phase 1 beads close |
| `cave-23nmv` (context) | Phase 1 gate | [#4833](https://github.com/OpenCoven/coven-cave/issues/4833) — open; last substantive note 2026-08-22: "Cannot pass. No Phase 1 implementation exists on `main`." | Stale relative to SDK #30/#54; the SDK-side lane of the gate's blocker list has since landed |

Gate relationship per #4833: the gate is blocked on `cave-9pifu` (Cave authority), `cave-tsvfj` (Chat native), `cave-lf7bu` (SDK Cave pairing), `cave-p8qkk` (this issue), `cave-0prpu` (real-authority conformance).

## 4. coven-cave daemon-side contract — verified at `main` tip `dacbe617` (2026-08-30)

Scope correction first: `server.ts` / `server.mjs` in `OpenCoven/coven-cave` are the **Cave sidecar** (Next.js HTTP server, `server.listen(port, hostname)`; the only pipe is the packaged Unix sidecar's stdin pipe). They are **not** a `coven.daemon.v1` server. The daemon (server side of the contract) is served by the Coven CLI — `OpenCoven/coven` exists (`pushed_at: 2026-08-30T09:50:05Z`; not verified further, out of scope). What `coven-cave` implements of `coven.daemon.v1` is the **client/discovery half** — which is exactly the contract the SDK must interoperate with:

| Contract element (as implemented in coven-cave) | Evidence (paths at `dacbe617`, 2026-08-30) |
|---|---|
| API version pin `coven.daemon.v1`; membership-set gate, not a minimum-version comparison; unknown/newer contracts refused fail-closed with wanted-vs-got diagnostics | `src/lib/daemon-startup-contract.ts` (`COVEN_DAEMON_API_VERSION`, `SUPPORTED_DAEMON_API_VERSIONS`, `assessDaemonStartupCompatibility` → `invalid_health` / `unsupported_api` / `invalid_runtime_version`) |
| Health document shape the SDK health path must validate against: `{ ok, apiVersion, covenVersion, daemon: { pid, startedAt, socket } }`; runtime version must be exact semver (CLI and daemon runtime release independently) | `src/lib/daemon-startup-contract.ts` (`DaemonStartupHealth`, `exactSemver` requirement) |
| Endpoint discovery precedence: `COVEN_SOCKET` env → (Windows) bounded `daemon.json` status file → `<COVEN_HOME>/coven.sock`; `COVEN_HOME` resolves from env else `~/.coven`; resolved at call time | `src/lib/coven-daemon.ts` (`resolveDaemonSocketPath`), `src/lib/coven-paths.ts` (`covenHome()`); coven-cave mirror of the SDK's `COVEN_HOME` + config-paths discovery |
| Fail-closed endpoint validation on the client: remote/off-machine Windows paths refused (`isRemoteWindowsPath`), `\\.\pipe\` normalization, a *refused* `COVEN_SOCKET` falls through to `daemon.json` instead of the default so a forged env var cannot deny-service a healthy local daemon; bounded 4 KiB status-file read (`cave-dy9`); refused-value reporting is bounded FIFO | `src/lib/coven-daemon.ts` (incl. the `COVEN_SOCKET` fallthrough comment), `src/lib/windows-local-path.ts` |
| Occupancy probe before launch: only a completed raw connect proves occupied, only `ECONNREFUSED`/`ENOENT` proves free; everything else is `unknown` and never refuses a launch | `src/lib/daemon-socket-occupancy.ts` |
| Launch/probe/supervision + fault coverage around the same contract | `src/lib/daemon-start.ts`, `daemon-connection-supervisor.ts`, `daemon-readiness.ts`, `daemon-endpoint-faults.test.ts`, `daemon-connectivity-faults.test.ts`, `scripts/daemon-connectivity-faults.test.ts` |
| Counterpart Cave-authority surface (Phase 1a lane, `cave-9pifu`) exists on `main`: `/api/client/v1` health/pairing/admin/conversations/familiars/projects routes, `client-v1-discovery.json` publisher, hpke-bound-v1 request binding (merged 2026-08-28, `163961f4e`) | `src/app/api/client/v1/*`, `server.ts` (`CLIENT_V1_DISCOVERY_FILE`), commit `163961f4e` |

The daemon side publishes `apiVersion: "coven.daemon.v1"` plus `covenVersion` and `daemon.{pid,startedAt,socket}` — the SDK's `CovenHealthResponse` and coven-cave's `DaemonStartupHealth` are the two verified consumers of that document, so any contract change must move all three repos together.

## 5. Implementation contract handoff for `OpenCoven/sdk`

> **Everything in §5 is DERIVED content** (from issue #4780, the 2026-08-15 plan of record + its 2026-08-20 supersession note, the 2026-08-20 approved spec, the 2026-08-20 phase-1b split plan, and the verified code cited in §2/§4). It is a handoff contract, not a record of shipped behavior except where it cites §2/§4 evidence.

### 5.1 Handoff note

**No push access to `OpenCoven/sdk` from this session** (`permissions.push: false`, verified 2026-08-30). Execution of anything in §5 must happen in `OpenCoven/sdk` by an actor with push access there. This repository's deliverable is this status record only. Per the approved spec, `cave-p8qkk` is Wave 1 and is independent of the Cave pairing schema; the Coven IPC lane merges as its own PR without any Cave-pairing dependency.

### 5.2 The `coven.daemon.v1` discovery/health contract (as verified)

1. **Discovery inputs, in order:** `COVEN_HOME` first (non-empty ⇒ use it, no CLI invocation); otherwise parse `coven config paths --json` from the Coven CLI (exact argv, sanitized environment allowlist, no shell, no caller-overridable executable, bounded output). On Windows, the profile's `state.daemon_ipc` from the config report selects the endpoint; daemon metadata (`socket`, `pid`, `startedAt`, `processCreationTime`) may refine it with freshness and owner checks. [plan 1b Task 2; sdk-main `discovery.ts` §2; coven-cave mirror §4]
2. **Endpoint validation:** accept only absolute local socket paths inside the reported Coven home (unix) or a reviewed local `\\.\pipe\` name (windows); reject remote hosts, relative/device paths, symlinks/FIFO substitution, copied metadata, cross-profile reports, duplicate or malformed IPC surfaces, oversized metadata, and deadline overrun. Fail with structured `CovenIpcError` codes, never flattened strings. [sdk-main tests §2; spec "Security Requirements"]
3. **Transports:** HTTP/1.1 over the Unix socket (`GET /api/v1/health`, capped header/body sizes) and the owner-only Windows named pipe, both requiring a transport-security provider: Unix `peer_identity` (socket file identity + peer uid/gid/pid), Windows `pipe_ownership` (ACL/identity inspection with `ownerOnly === true` and owner == current user identity). Missing platform security ⇒ `platform_security_unavailable`, fail closed. [sdk-main §2]
4. **Health negotiation:** `health()` requires `ok === true`, `apiVersion === 'coven.daemon.v1'` (exact membership — the coven-cave gate refuses unknown *newer* contracts too, `SUPPORTED_DAEMON_API_VERSIONS`), and an exact-semver `covenVersion`. Incompatible/missing fields produce structured diagnostics naming both sides. [coven-cave `daemon-startup-contract.ts` §4; sdk-main `client.ts`/`schemas.ts` §2]
5. **Error preservation:** structured daemon error objects are re-materialized with bounded depth/size and sensitive-field redaction — never flattened into strings. [sdk-main `transport-unix.ts` §2]
6. **Purity and boundary:** no I/O at import time; exports stay `.` and `./package.json`; handwritten guards, no Zod; the SDK reads no Coven SQLite and no daemon data files — only the two sanctioned discovery channels above. [plan 1b "current-state rules"; sdk-main `import-purity.spec.ts`]
7. **CLI:** `opencoven coven health [--json]` goes through the SDK discovery + transports (no bespoke child-process parser); output is secret-free and structured. [plan 1b Task 4; sdk-main `packages/cli/src/coven.ts` §2]

### 5.3 Fail-closed acceptance items (issue #4780) and their verified coverage

| Acceptance item | Where it is covered (sdk `main`, 2026-08-30) |
|---|---|
| IPC transports preserve structured daemon errors | `CovenDaemonResponseError` bounded reconstruction + `CovenIpcError` codes/`diagnostics.phase` (`packages/coven/src/{discovery,transport-unix}.ts`) |
| Forged socket paths fail closed | `tests/coven-discovery.spec.ts`: unsafe endpoint paths, IPC path outside reported Coven home, FIFO-after-lstat rejection, metadata path-replacement rejection, deadline enforcement |
| Named-pipe ownership mismatch fails closed | `transport-windows.ts` `validateIdentity` (`ownerOnly !== true` ⇒ unsafe; owner ≠ current user ⇒ `owner_mismatch`); CLI requires the `pipe_ownership` provider (`packages/cli/src/coven.ts`) |
| Never reads Coven SQLite or daemon files directly | Discovery limited to `coven config paths --json` + bounded daemon metadata record; SQLite hits: 0 (code search, index-lag caveat); boundary tests `tests/package-boundaries.spec.ts`, `tests/import-purity.spec.ts` |

### 5.4 Derived gap analysis (what remains in `OpenCoven/sdk`)

- **Appears done (verify, don't rebuild):** all three deliverables and the three fail-closed acceptance items, per §2 — landed 2026-08-22 → 2026-08-29 (#30, #54, #64, #73).
- **Not verifiable read-only from here, owner must confirm:** (a) Bead `cave-p8qkk` closure state in the Beads store; (b) Phase 0 gate `cave-bt9wx` state; (c) live-daemon conformance evidence (the gate `cave-23nmv` owns cross-repo evidence, and `conformance/` holds the client-v1 evidence schema); (d) Windows named-pipe runtime validation (release lane); (e) whether any hardening landed *after* #73 (this verification is pinned to the tip fetched 2026-08-30).
- **Recommended first action for the sdk executor:** run the §5.5 checklist against current `main`; if every row holds, the correct action is bead/gate bookkeeping (§5.6), not a new PR.

### 5.5 Exact PR checklist for the sdk PR (DERIVED from plan 1b Tasks 1–2 + issue #4780 acceptance criteria)

> If #30 already satisfies a row, check the row off against the merged commit instead of re-implementing. A residual PR should touch only rows that fail.

- [ ] Branch `phase1b/sdk-coven-ipc` (or a fresh `docs`/`fix` branch) from current `OpenCoven/sdk` `origin/main`; worktree per repo convention.
- [ ] `packages/coven/src/discovery.ts`: `COVEN_HOME` honored without invoking the CLI; fallback to exact `coven config paths --json` argv with sanitized env; bounded metadata read; freshness/owner checks; `CovenIpcError` codes (`not_found`, `command_failed`, `malformed_config`, `unsafe_endpoint`, `owner_mismatch`, `connect_failure`, `timeout`, `body_limit`, `frame_limit`, `invalid_response`) preserved.
- [ ] `packages/coven/src/transport-unix.ts` + `transport-windows.ts`: same-user Unix socket / owner-only Windows named pipe; endpoint revalidated at connect; structured daemon errors preserved with bounds + sensitive-field redaction.
- [ ] Windows pipe: ownership adapter requires `ownerOnly === true` and owner == current user identity, else `owner_mismatch` / `unsafe_endpoint`; connected-handle validation per spec.
- [ ] `packages/coven/src/client.ts` `health()`: `apiVersion` must equal `COVEN_DAEMON_PROTOCOL` exactly; malformed health ⇒ `invalid_response`.
- [ ] `packages/cli/src/coven.ts`: `opencoven coven health [--json]` requires the platform security provider; missing/incompatible CLI surfaces produce structured, secret-free diagnostics (`platform_security_unavailable`, apiVersion mismatch, `invalid_response`).
- [ ] Forged-path and attack tests present and green: unsafe discovered paths, IPC path outside reported Coven home, copied metadata rejection, FIFO-after-lstat, path replacement after open, oversized stderr/stdout, deadline enforcement.
- [ ] No import-time I/O (`tests/import-purity.spec.ts`); exports stay `.` and `./package.json` (`tests/public-contract.spec.ts`, `tests/package-manifests.spec.ts`); no new runtime deps that could reach Coven SQLite or daemon data files.
- [ ] Packed boundary intact: `tests/packed-package.spec.ts`, `tests/packed-package` coverage of `@opencoven/coven-client` exports unchanged.
- [ ] Full verification matrix (plan 1b): `corepack pnpm@10.34.0 verify` — typecheck, tests, recursive build, contract verification, packed/offline verification, coverage, stress, lint. No release/publish scripts.
- [ ] Commit message conventional (`feat:`/`fix:`/`docs:`); no secrets, bearer values, keychain payloads, raw env, or arbitrary filesystem contents in JSON output; no AI-attribution trailers (repo rule).

### 5.6 Post-merge bookkeeping (not a code change)

1. Close/annotate bead `cave-p8qkk` in Beads with the merged evidence per spec's closure rule: repository, branch, merged commit (`3ab5b3132` for Wave 1), tests, CI links, secret scan, known limitations.
2. Reconcile the GitHub mirror #4780 and the gate #4833 record (its "no Phase 1 implementation" note predates SDK #30 by design — the gate closes on verified cross-repo evidence, not on code alone).
3. Confirm `cave-bt9wx` (Phase 0 gate) state via `bd show cave-bt9wx`; it is the only dependency bead with no GitHub-visible record.

## 6. Evidence index (all fetched 2026-08-30)

| Evidence | Link / path |
|---|---|
| Issue (mirror of `cave-p8qkk`) | https://github.com/OpenCoven/coven-cave/issues/4780 |
| Phase 1 epic (`cave-fz01p`) | https://github.com/OpenCoven/coven-cave/issues/4818 |
| Phase 1 gate (`cave-23nmv`) | https://github.com/OpenCoven/coven-cave/issues/4833 |
| Plan of record (with 2026-08-20 supersession note) | https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-1-discovery-pairing.md |
| Approved spec (supersedes plan's implementation details) | https://github.com/OpenCoven/chat/blob/main/docs/superpowers/specs/2026-08-20-phase-1-discovery-pairing-design.md |
| Phase 1b SDK split plan (Coven IPC = Task 2, Wave 1) | https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-20-phase-1b-sdk-discovery-pairing.md |
| SDK Wave 1 merge | commit `3ab5b3132`, 2026-08-22, `feat: discover Coven daemon endpoints (#30)` — `repos/OpenCoven/sdk/commits?path=packages/coven` |
| SDK Wave 2 / baselines / conformance | `a57ca8ea1` (#54, 2026-08-24), `3d2e61f71` (#64, 2026-08-25), `4736bf2e0` (#73, 2026-08-29) |
| SDK sources verified | `packages/coven/src/{schemas,discovery,transport-unix,transport-windows,client}.ts`, `packages/core/src/discovery.ts`, `packages/cli/src/coven.ts` (Contents API, tip `4736bf2e0`) |
| SDK permissions (read-only for this token) | `gh api /repos/OpenCoven/sdk` → `push: false`, fetched 2026-08-30 |
| coven-cave client-side contract | `src/lib/daemon-startup-contract.ts`, `src/lib/coven-daemon.ts`, `src/lib/windows-local-path.ts`, `src/lib/daemon-socket-occupancy.ts`, `src/lib/coven-paths.ts`, `server.ts` at `main` tip `dacbe617` (2026-08-30) |
| Daemon (server side) repo | https://github.com/OpenCoven/coven (existence + timestamps only; out of scope) |
