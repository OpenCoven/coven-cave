# Daemon connectivity program completion

Status: active  
Program: `cave-58eoq`  
Baseline captured: 2026-08-10

This document is the execution baseline for finishing the daemon-connectivity
program. It records what has landed, what is implemented but not landed, which
parallel session owns each remaining unit, and the evidence required before the
program can close.

## Completed and landed

| Unit | Outcome | Evidence |
| --- | --- | --- |
| `cave-58eoq.1` | Windows packaged sidecar supervision | PR #4485 merged. Startup, manual retry, and automatic revival share `SidecarStartupControl`; shutdown and process-job cleanup are ordered and bounded. |
| `cave-ruw4z` design | User-bound loopback authentication design | PR #4483 merged. Direct TCP loopback is explicitly not treated as OS-user identity. |
| Parent audit implementation | System map, ranked inventory, state machine, FMEA, warning audit, recovery matrix, transport hardening, and diagnostic specification | Branch `fix/cave-58eoq-daemon-connectivity-audit` at `d8fc53dd30` is pushed; PR creation remains pending. |
| CLI/endpoint security subset | Exact credential-origin binding, remote plaintext bearer refusal, ad-hoc probe credential isolation, and PTY/REST/query/discovery enforcement | Recorded on `cave-58eoq.6`; Node, app, API, mobile, and isolated Swift checks passed. |

## Implemented, not yet landed

| Unit | Owner/worktree | Current state | Required next action |
| --- | --- | --- | --- |
| `cave-58eoq.2` authenticated native readiness | `fix/cave-58eoq-2-authenticated-readiness` | Complete, uncommitted. Native GUI and background startup require a bounded sidecar-token-authenticated identity/protocol/version/runtime/dependency handshake. Full app/API/Rust validation and independent reviews are green. | Reconcile with current `origin/main`, commit, push, open PR, run required checks, review, and merge. |
| `cave-58eoq.3` correlated diagnostics | Parallel session in `.worktrees/cave-58eoq-3-correlated-diagnostics` | Active dirty implementation spanning Rust lifecycle events, daemon routes, CLI execution, redaction, and export. | Preserve parallel ownership. Review and land only after that session records a handoff. |
| `cave-58eoq.4` fault injection | Parallel session on `fix/cave-58eoq-4-fault-injection` | PR #4489 open at `182c7dce33`; initial deterministic fault harness is in CI. Remaining real lifecycle stress is still listed on the Bead. | Let CI finish, review findings, merge the current increment, then complete the remaining stress matrix without duplicating the active owner. |
| `cave-58eoq.5` reliability budgets | Parallel session in `.worktrees/cave-58eoq-5-reliability-budgets` | Active dirty implementation for metrics, benchmark tooling, supervisor instrumentation, and budget documentation. | Preserve parallel ownership. Review distributions, retention bounds, and acceptance budgets at handoff. |
| `cave-58eoq.6` exhaustive CLI/socket contract | No dedicated active worktree | High-impact security subset is done, but the acceptance criterion requires proof across every remaining spawn/socket boundary, unusual paths, cancellation, malformed payloads, permissions, and corrupt binaries. | Audit the remaining execution inventory, add missing tests/fixes, then land with the parent audit or a dedicated PR. |

## Execution order

1. Land `cave-58eoq.2` authenticated readiness.
2. Open and land the pushed parent audit branch, rebasing only if required.
3. Complete the remaining `.6` CLI/socket execution inventory and fixes.
4. Monitor and review the active `.3`, `.4`, and `.5` owners without editing
   their files or branches.
5. Integrate their handoffs in dependency order: diagnostics and metrics before
   final stress/budget conclusions.
6. Run the complete validation matrix from clean current `main`.
7. Update the main reliability report with measured before/after results,
   cross-platform outcomes, and the final residual-risk register.
8. Close child Beads only after merge, then close `cave-58eoq` when every
   acceptance criterion below is supported by merged code and evidence.

## Program completion gates

- Normal startup reaches authenticated sidecar readiness without user action.
- Concurrent launches cannot create conflicting owned sidecars or daemons.
- Post-ready crashes recover through bounded, cancelable, observable policy on
  macOS, Linux, and Windows.
- Local and remote credentials are never sent over an unsafe transport or to a
  different origin.
- Loopback access is user-bound whenever authentication is armed.
- Every CLI and socket boundary has explicit timeout, size, cancellation,
  compatibility, redaction, and process-ownership contracts.
- One correlation ID spans native startup/recovery, sidecar API work, daemon
  requests, and CLI executions.
- Exported diagnostics are bounded and automatically redact credentials,
  personal paths, conversation content, and unrelated environment values.
- Fault injection covers refusal, timeout, reset, malformed/partial data,
  crashes, hangs, stale endpoint state, cancellation, and repeated lifecycle
  stress on supported operating systems.
- Startup and recovery budgets have explicit definitions, distributions,
  retention limits, and reproducible benchmark commands.
- No UI or diagnostic claims connected, healthy, recovered, or fixed before the
  authenticated end-to-end contract succeeds.
- All required PR checks pass on exact heads; final verification runs from clean
  current `main`.

## Known blockers and constraints

- Parallel sessions own `.3`, `.4`, and `.5`; duplicate edits would risk
  overwriting active work.
- The `.3` and `.5` fallback worktrees lack structured lifecycle metadata and
  require pushed archive tags plus manual retirement after landing.
- Local Windows cross-compilation cannot prove native C dependencies without a
  Windows toolchain; repository Windows CI and release-host validation remain
  authoritative.
- Focused iOS Xcode tests remain blocked before compilation by unresolved
  WebRTC revision `6ed87f05368632f71dc95c89c14c051561710925`.
- Hardware-only Defender, signing, quarantine, installer, sleep/wake, and
  abrupt-power-loss behavior require supported release hosts.

## Update cadence

Post a progress update when a unit changes phase: implementation complete, PR
opened, CI result, review finding, merge, new blocker, or final program
reconciliation. Do not report routine command-by-command activity.
