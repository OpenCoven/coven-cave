## #5762 delivery and producer-decision handoff

PR #6050 merged as `9044e55ce050727285f14e7ff12a79cea3fd1262`. Reviewed/tested PR head: `35df65bb1ee02118920d1b4607b7bc0306226d6c` (signed and GitHub verified). The merged six-file patch matches the verified head. The attached goal reaches its explicit producer-decision handoff condition; this issue remains open until Val records that decision.

[Criterion map and producer limitations on main](https://github.com/OpenCoven/coven-cave/blob/9044e55ce050727285f14e7ff12a79cea3fd1262/docs/design/runtime-model-tool-identity.md#5762-qualification-map-2026-10-18).

| Original requirement | Evidence on merged main |
| --- | --- |
| scope-01: versioned reasoning and legacy decoding | `chat-reasoning-blocks.test.ts`, `server/legacy-reasoning-projection.test.ts`, `chat-activity-corpus.test.ts` |
| scope-02: call/attempt/source/time and distinct lifecycle states | `chat-tool-provenance.test.ts`, `chat-tool-outcomes.test.ts`; approval-requested, cancel-requested, cancelled, policy-rejected and user-rejected retain separate semantics |
| scope-03: authoritative bindings and receipt references | Forged authority is rejected and unavailable fields are preserved by `chat-tool-provenance.test.ts`; **Val's producer decision remains open** |
| scope-04: disclosure before live/retained presentation | `chat-display-disclosure.test.ts` and `api/chat/send/route-hermes-disclosure.integration.test.ts` |
| scope-05: split units and opaque state isolation | Hermes route fixture streams seven-byte UTF-8 fragments, split credentials, opaque signatures and conflicting summaries; shared activity corpus checks fragmented decoding |
| scope-06: mappings and canonical ownership | Linked design document records mappings and the existing Coven/Threads/Psyche/Runtimes/SDK boundaries; chat binding/receipt contract is the remaining decision |
| acceptance-01: validators, contradictory data, unknown versions | `chat-tool-provenance.test.ts`, `chat-reasoning-blocks.test.ts`, shared activity corpus |
| acceptance-02: golden new/legacy and lifecycle serialization | Shared activity corpus plus explicit lifecycle JSON round trips, labels and timestamp assertions in `chat-tool-provenance.test.ts` |
| acceptance-03: forged receipts, markers, output and disclosure claims | Provenance/disclosure fixtures and Hermes route with forged `coven:receipt` and actual `coven:proposal-review` permit markers; text cannot populate trusted authority |
| acceptance-04: sentinels across all named boundaries | Hermes route checks SSE, replay strings, raw persisted JSON, loaded history, ordinary console logs, authenticated Client v1 messages response and HFR JSONL export |
| acceptance-05: bounds, parallel IDs, deduplication and migration | `chat-tool-events.test.ts`, `chat-tool-outcomes.test.ts`, legacy projection tests and shared corpus |
| acceptance-06: registry and design document | Existing entries in `scripts/run-tests.mjs`; all 2,074 tests wired; linked design map and exact producer mappings |

Library test paths above are under `src/lib/`; the route fixture is under `src/app/`. The tests prove display/projection behavior and the synthetic-provider route, not new native producer support or human accessibility acceptance under #5763–#5767.

Verification: focused contracts and route tests, typecheck, full lint, registry and diff checks passed. All 1,442 app files passed across registry runs (465 + 786 + 191); all 517 API files passed (347 + 170). Initial local interruptions came from isolation overrides conflicting with fixture-owned homes/socket paths. Assertions and product code were not weakened; original logs and continuation runners are retained. All applicable exact-head hosted checks passed before merge, including the required Frontend build. The iOS build was skipped by path selection; no native-build qualification is claimed. The requested merge helper ran with an added `--match-head-commit` guard; no admin override or protection change.

### Only remaining blocker: Val's producer-contract decision

**Val: record whether Cave should retain explicitly unavailable binding/approval/effect references for this contract, or settle the authenticated chat binding and receipt-read contract in [OpenCoven/coven#1137](https://github.com/OpenCoven/coven/issues/1137).** That existing issue owns chat source/isolation and receipt/dispatch reconciliation. Its latest reconciliation confirms the daemon ledger (#1209) and verified issuer (#1210) are delivered; automation #857 does not substitute for chat authority. If references are required, the producer contract must identify their authenticated source, run/attempt/session and familiar-revision binding, read authorization, and unavailable/revoked behavior. Cave must not infer them from names, text, hooks or client claims.

This is a recorded handoff on the canonical issue, not a claim that Val has accepted the limitation or that an upstream worker acknowledged it. No producer-side implementation was started. Original acceptance and ownership remain unchanged; no closure or Project Done claim.

Worktree disposition: `.worktrees/issue-5762-disclosure-qualification`, branch `fix/issue-5762-disclosure-qualification`, intentionally preserved by Val's current session for local verification artifacts and the producer handoff. No cleanup or remote deletion was performed. Nothing under `~/.coven` was modified or deleted. The shared checkout and other owners' worktrees were left untouched.
