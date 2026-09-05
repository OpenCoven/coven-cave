# Chat v1 P1 — Native Discovery, Launch, Keychain, and Connection State: Working Record and Claimable Scope

> **Current refresh — 2026-09-04:** Implementation and canonical Phase 1 gate
> closure are complete. OpenCoven/chat#41 merged on 2026-08-30 and later
> hardening continued through OpenCoven/chat#55. GitHub #4780 and #4830 are
> closed, while #4830
> still lacks an on-issue closure-evidence comment. Treat that as mirror
> hygiene, not an implementation blocker. OpenCoven/chat CI run `33853544991`
> at `1e8597d3a6195fcce2fa8f76b28dc9bdd9bec985` passed the Phase 1
> real-authority job and retains its report through 2026-09-18. Chat `main` has
> advanced again and its newest run is still in progress.

Bead `cave-tsvfj` · Issue [#4830](https://github.com/OpenCoven/coven-cave/issues/4830) · Phase 1 · owner **Chat** · surface `desktop`

**Verified 2026-08-30.** Every claim below was re-checked read-only against the GitHub API on 2026-08-30. Evidence links carry their own dates. This record supersedes the state line in the #4830 issue body (verified 2026-08-22) and refines the 2026-08-24 reassessment comment ([#4830 comment](https://github.com/OpenCoven/coven-cave/issues/4830#issuecomment-5394655968)).

## Verdict

The recorded state of this bead is stale in both halves:

1. **The recorded blocker is resolved.** `cave-9pifu` ([#4829](https://github.com/OpenCoven/coven-cave/issues/4829)) is **closed**. The pairing authority — admin credentials, pairing requests, the exchange, health, and revocation — landed on Cave `main` via [#4840](https://github.com/OpenCoven/coven-cave/pull/4840) (merged 2026-08-22T06:36Z) and was extended by [#4875](https://github.com/OpenCoven/coven-cave/pull/4875) (merged 2026-08-23T02:14Z, Settings-managed Client v1 access, `cave-9pifu.3`). A real authority to pair against exists: socket-level conformance runs against it are recorded under `docs/client-v1-conformance-results/` (2026-08-22 and 2026-08-23 runs).
2. **"Not started" is no longer true — and was already false at the last reassessment.** The 2026-08-24 comment correctly said Chat `main` still had only the Phase 0 scaffold, but between 2026-08-28 and 2026-08-29 OpenCoven/chat merged the Phase 1c native connection implementation ([#31](https://github.com/OpenCoven/chat/pull/31)) and its hardening wave ([#34](https://github.com/OpenCoven/chat/pull/34), [#36](https://github.com/OpenCoven/chat/pull/36), [#38](https://github.com/OpenCoven/chat/pull/38), [#39](https://github.com/OpenCoven/chat/pull/39)), plus the Phase 1d real-authority conformance gate ([#30](https://github.com/OpenCoven/chat/pull/30)). Chat `main` now ships the native discovery, launch, keyring, constrained transport, pairing, and connection-state surface this bead names.
3. **Code search can no longer serve as evidence for OpenCoven/chat.** `gh api "search/code?q=repo:OpenCoven/chat+pairing"` returns `total_count: 0` on 2026-08-30 — but so do `keychain`, `keyring`, `connection`, and `tauri`, although `src-tauri/` and `src/connection-gate.tsx` have been on that repo's `main` since 2026-08-28. The GitHub code-search index for the repository is stale; git history and the PR/tracking APIs are the only reliable evidence there.
4. **What remains claimable is evidence closure, not implementation.** Open chat PR [#41](https://github.com/OpenCoven/chat/pull/41) (real-authority conformance hardening) must land, and the completed, secret-scanned `phase1-conformance` report at the revisions pinned in the repo's `phase1-conformance.lock.json` must be produced and cited — per register operating rule 8, a gate cannot close on unit-test proxies alone. The bead/issue records (#4830, gate [#4833](https://github.com/OpenCoven/coven-cave/issues/4833)) still carry pre-landing state text and need refreshing at closure time.

## Verified implementation-state table (2026-08-30)

| Bead | Issue | Owner | State 2026-08-30 | Evidence (dated) |
|---|---|---|---|---|
| `cave-9pifu` | [#4829](https://github.com/OpenCoven/coven-cave/issues/4829) | Cave | **Closed — landed.** Pairing authority end to end on Cave `main`. | #4829 closed 2026-08-22; [#4840](https://github.com/OpenCoven/coven-cave/pull/4840) merged 2026-08-22T06:36Z (authority + route table + discovery contract); [#4875](https://github.com/OpenCoven/coven-cave/pull/4875) merged 2026-08-23T02:14Z; recorded socket-level runs in `docs/client-v1-conformance-results/` (2026-08-22, 2026-08-23) |
| `cave-lf7bu` | [#4831](https://github.com/OpenCoven/coven-cave/issues/4831) | SDK | **Closed — landed.** | #4831 closed 2026-08-24; [sdk#54](https://github.com/OpenCoven/sdk/pull/54) merged as `a57ca8ea` (769 tests + release chain); P0 atomic instance-binding [#4996](https://github.com/OpenCoven/coven-cave/issues/4996) closed 2026-08-26; sdk hpke-bound-v1 [#69](https://github.com/OpenCoven/sdk/pull/69) 2026-08-28 |
| `cave-p8qkk` | [#4780](https://github.com/OpenCoven/coven-cave/issues/4780) | SDK | **Open — partial.** | Gate record 2026-08-23 (`docs/workflows/chat-v1-phase-1-gate.md`): sdk#30 (`3ab5b3132`, 2026-08-22) landed Coven discovery + Unix/Windows named-pipe transports; `opencoven coven health` and CLI diagnostics still outstanding. The Chat-side `coven_health` probe landed separately via chat#38 (2026-08-29) |
| `cave-0prpu` | [#4832](https://github.com/OpenCoven/coven-cave/issues/4832) | Cross-repo | **Closed (Cave half); harness landing across repos.** | [#4859](https://github.com/OpenCoven/coven-cave/pull/4859) merged 2026-08-22 (Cave half; SDK/Chat halves recorded in its `notCovered`); chat#30 (2026-08-29) adds the 15-assertion packaged real-authority gate; sdk#73 (2026-08-29) adds the cross-repository evidence contract; chat#41 open |
| `cave-tsvfj` (**this bead**) | [#4830](https://github.com/OpenCoven/coven-cave/issues/4830) | Chat | **Open — implementation landed; gate evidence and record refresh outstanding.** | Plan merged via [chat#25](https://github.com/OpenCoven/chat/pull/25) 2026-08-20T22:49Z; implementation landed via chat#31/#34/#36/#38/#39/#30, 2026-08-28/29 (details below); chat#41 open (updated 2026-08-30T09:43Z) |
| `cave-23nmv` (Phase 1 gate) | [#4833](https://github.com/OpenCoven/coven-cave/issues/4833) | Cross-repo | **Open — verdict NOT PASSED as of 2026-08-23; Chat-side blockers EG3/EG5 now have implementation.** | `docs/workflows/chat-v1-phase-1-gate.md` (verdict 2026-08-23): Cave half implemented and guarded; SDK and Chat halves "do not exist" — that is no longer true for Chat; the gate still requires the completed cross-repo real-authority record before closing |

## What landed in OpenCoven/chat, with evidence

| PR | Merged (UTC) | Content relevant to `cave-tsvfj` |
|---|---|---|
| [chat#25](https://github.com/OpenCoven/chat/pull/25) | 2026-08-20T22:49Z | Plan only: `2026-08-15-phase-1-discovery-pairing.md` (plan of record, Exit Gates), the 2026-08-20 split plans (`phase-1a` Cave, `phase-1b` SDK, **`phase-1c` Chat native connection**, `phase-1d` real-authority conformance), and the design spec. No implementation. |
| [chat#31](https://github.com/OpenCoven/chat/pull/31) | 2026-08-28T16:15Z | The Phase 1c implementation: Tauri-native Cave trust boundary; strict discovery-record validation; HPKE-bound protected operations; exact-path launch; native keyring; constrained `/api/client/v1` transport; pairing create/poll/exchange with distinct cancellation, expiry, denial, revocation, rate-limit, offline, and incompatibility recovery states; blocking read-only connection gate; Rust + native RPC + TypeScript coverage. |
| [chat#34](https://github.com/OpenCoven/chat/pull/34) | 2026-08-29T02:13Z | Pins canonical SDK release artifacts for the contract canary. |
| [chat#36](https://github.com/OpenCoven/chat/pull/36) | 2026-08-29T02:28Z | Hardens native credential custody: platform-native binary secret stores, zeroizing secret owners across keyring/pairing/HPKE paths, bounded Unix locking, verified Windows global locking. |
| [chat#38](https://github.com/OpenCoven/chat/pull/38) | 2026-08-29T04:24Z | Production `coven_health` through the pinned producer-owned Rust client, isolated in a reaped self-child probe; strict native/webview health state. |
| [chat#39](https://github.com/OpenCoven/chat/pull/39) | 2026-08-29T05:12Z | `phase1-conformance`-only native provider preset: missing-keychain trust rejects at the production `NativeKeyring` boundary before any filesystem/keychain mutation (fail closed). |
| [chat#30](https://github.com/OpenCoven/chat/pull/30) | 2026-08-29T11:46Z | Phase 1d real-authority conformance gate: runs all 15 required Phase 1 assertions against packaged real authorities at the revisions pinned in `phase1-conformance.lock.json` (chat `20633346c`, sdk `acc38488f`, cave `086b6421d`, coven `721437b8`); fresh packaged-Cave API-major/minimum-client compatibility checks; sanitized, secret-scanned report; macOS CI evidence job. |

Follow-on hardening already on `main`: #35 (empty HPKE exchange bodies, 2026-08-29), #37 (authenticated read error envelopes, 2026-08-29), #40 (canonical cursor walks, 2026-08-30). **Open:** [#41](https://github.com/OpenCoven/chat/pull/41) — repins the conformance harness to exact artifacts and adds production `coven_health`/keyring custody with crash-safe cleanup and restart handoff (updated 2026-08-30T09:43Z).

Native surface verified on Chat `main` (git trees + contents API, 2026-08-30):

- `src-tauri/src/`: `cave.rs` (validated `client-v1-discovery.json` loading; loopback-only, query/fragment and body-limit guards incl. Windows liveness metadata), `keyring.rs`, `transport.rs`, `hpke_bound.rs`, `connection.rs`, `coven.rs`, `conformance.rs`, `commands.rs`, `bin/phase1-native-rpc.rs`.
- Registered commands: `cave_read_discovery`, `cave_launch`, `cave_health`, `coven_health`, `cave_pairing_create`, `cave_pairing_poll`, `cave_pairing_exchange`, `cave_reset_pairing`, `cave_credential_status`, `cave_forget_credential`, plus read clients (`cave_list_familiars`, `cave_list_projects`, `cave_list_conversations`, `cave_get_conversation`, `cave_list_conversation_messages`) and `cave_cancel_operation` — discovery, launch, health, pairing, and credential management are all present.
- `src/connection-gate.tsx` (+ test, CSS) renders the blocking production gate; `src/lib/sdk/connection-controller.ts` defines the visible state machine `SdkConnectionState`: `idle`, `discovering`, `incompatible`, `pairing_required`, `pairing`, `ready`, `revoked`, `offline`, `error` — including the upgrade-required state the Exit Gates call `incompatible`.
- E2E: `e2e/connection-gate.spec.ts`, `e2e/app.tauri-mock.spec.ts` (preview Playwright stays separate).

## Claimable scope breakdown (executing repo: OpenCoven/chat)

Items are decomposed from the merged Phase 1 plans — `2026-08-15-phase-1-discovery-pairing.md` (Exit Gates) and `2026-08-20-phase-1c-chat-native-connection.md` (tasks 1–5) — and are marked **[derived]** with their plan source. Ordered so every item stays buildable and testable against deterministic fixtures first, with the live authority only needed at the final conformance step; the live authority now exists (item 0), so nothing is blocked.

0. **[derived: #4829/#4840]** Real pairing authority on Cave `main` — **landed 2026-08-22/23.** Not a Chat item; listed because the plan's fixture-first ordering was contingent on it.
1. **[derived: phase-1c Task 1]** Native discovery of a running Cave: validated discovery-file loading, candidate selection, loopback/liveness guards — **landed** chat#31; guards covered by Rust tests (`unsafe_discovery_record`, body limit, Windows liveness) and the native E2E harness.
2. **[derived: phase-1c Task 1]** Exact-path Cave launch with readiness wait (`cave_launch` command, no `PATH` search) — **landed** chat#31.
3. **[derived: phase-1c Task 1 + Exit Gate EG1]** Keychain-backed credential storage: installation-id and bearer store/delete through native secure storage, zeroizing custody, fail-closed on missing keychain — **landed** chat#31, hardened chat#36, fail-closed control chat#39.
4. **[derived: phase-1c Tasks 1–2]** Constrained `/api/client/v1` transport (redirect/size limits, HPKE-bound protected operations) with a typed, fakeable desktop bridge — **landed** chat#31 (+ sdk hpke-bound-v1 #69).
5. **[derived: phase-1c Tasks 3–4 + Exit Gates EG3/EG4]** Visible connection state machine and blocking gate: discover → launch → readiness → compatibility → credential probe → pairing → connected, with `incompatible` on wrong API major and reconnect-without-repairing after restart — **landed** chat#31 (`SdkConnectionState`, `connection-gate.tsx`, E2E specs); restart handoff further hardened in open chat#41.
6. **[derived: phase-1d Task; register rule 8]** Real-authority conformance evidence: the 15 required assertions against packaged Chat/SDK/Cave/Coven at the locked revisions, sanitized and secret-scanned — **gate landed** chat#30; **remaining claimable work:** land chat#41 (harness repin + restart handoff), produce the completed report, and cite it on #4833/#4830.
7. **[derived: phase-1c Task 5]** Record refresh at closure: close bead `cave-tsvfj` with the register's evidence template and update the stale state text in #4830 (the issue body still says "Not started") — **remaining claimable work.**

Out of scope for this bead, for disambiguation: `opencoven coven health` and the CLI diagnostics belong to `cave-p8qkk` (#4780, still partial); the SDK Cave client is `cave-lf7bu` (closed); the Phase 1 gate itself is `cave-23nmv` (#4833).

## Handoff note

The `CompleteDotTech` token used for the coven-cave automation has **no push access to OpenCoven/chat** (verified 2026-08-30). Everything above was verified read-only through the GitHub API. Execution of the remaining claimable items (chat#41 merge, the completed conformance report, and the bead/issue record updates) must happen in **OpenCoven/chat** by an account with write access there. This repository carries only this working record and the status comment on #4830.

## Method (reproduce this record)

All commands run 2026-08-30 against `OpenCoven/chat`, `OpenCoven/sdk`, and `OpenCoven/coven-cave`:

```
gh api "search/code?q=repo:OpenCoven/chat+pairing" --jq .total_count          # 0 (stale index — see Verdict 3)
gh api repos/OpenCoven/chat/commits --jq '.[] | .sha[0:9] + " " + .commit.committer.date'
gh pr list --repo OpenCoven/chat --state all
gh api "repos/OpenCoven/chat/git/trees/main?recursive=1"                       # native surface present
gh api /repos/OpenCoven/chat/contents/<path> --jq .content | base64 -d        # register, phase-1/1c plans, commands.rs, cave.rs, connection-controller.ts, phase1-conformance.lock.json
gh issue view 4829/4830/4831/4833/4996 --repo OpenCoven/coven-cave
gh pr view 4840/4875 --repo OpenCoven/coven-cave
```

The canonical Beads database is not reachable from this checkout (`.beads/issues.jsonl` on `main` does not contain the `chat-v1` program beads), which is why the GitHub issues are the working record — as #4830 itself notes.
