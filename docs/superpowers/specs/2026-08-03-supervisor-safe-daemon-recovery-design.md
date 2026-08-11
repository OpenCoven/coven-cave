# Supervisor-safe daemon recovery

## Problem

Cave treats a definitive local-offline connection poll as permission to run
`coven daemon start`. That is safe when Cave is the only lifecycle owner, but
not when launchd, systemd, or another supervisor already owns a foreground
`coven daemon serve` process. A live but temporarily unreachable owner still
holds `daemon-serve.lock`; a competing start correctly fails rather than risk
two SQLite writers, while the supervisor may repeatedly relaunch and Cave may
show transient offline/start-failed banners.

The live machine evidence on 2026-08-03 showed exactly this state: one healthy
launchd-owned daemon, a serve-lifetime lock held by that process, 1,752 launchd
runs, and repeated lock-contention diagnostics. The lock is protection, not
the defect. The defect is Cave treating health failure as proof that no owner
exists.

## Requirements

1. Never weaken the serve-lifetime lock, remove daemon state, or signal an
   unverified PID.
2. Automatic recovery must not spawn when the CLI reports a live but
   unreachable daemon owner.
3. A supervisor that wins a start race must count as successful recovery even
   if Cave's launcher exits non-zero.
4. The shell must stay quiet during a bounded automatic recovery window.
5. A still-offline daemon after that window must restore the existing truthful,
   actionable banner. Manual Start remains immediately diagnostic.
6. Existing sessions and the SQLite ledger remain untouched throughout.

## Design

### Lifecycle preflight

`startLocalDaemon` gains an injectable automatic-recovery preflight backed by
`coven daemon status --json`. The normalized result is `running`, `stopped`,
`stale`, or `unknown`.

- `running`: return the existing already-running success.
- `stopped`: continue with the existing start path.
- `stale`: return a structured `owner_unreachable` deferred result without
  spawning or signaling anything.
- `unknown`: fail closed for automatic recovery with a structured deferred
  result; manual Start retains the current direct diagnostic path.

This check is advisory and race-prone by construction, so the existing
serve-lifetime lock remains authoritative.

### Start-race grace

If the launcher exits before health is ready, readiness continues for a short,
bounded grace instead of taking one immediate final probe. This accepts the
case where a supervisor acquires ownership just after Cave's attempted start.
If no healthy daemon appears, Cave reports the original failure and cleans up
only the process tree it launched.

### UI recovery state

Automatic calls post `{ automatic: true }`; manual calls keep the current
request shape. Workspace tracks a small recovery presentation state:

- `recovering`: an automatic request is in flight; suppress offline and start
  error banners.
- `deferred`: a live/unknown owner prevented a competing spawn; suppress the
  banner for two fresh connection polls.
- `idle`: healthy or no recovery underway.
- `failed`: bounded recovery did not return health; use the existing banner and
  manual Start action.

A running connection poll immediately clears recovery state. Two subsequent
definitive offline polls exhaust a deferred window. Status-unavailable and
authentication failures keep their existing distinct UI paths.

## Verification

- Unit tests prove stale/unknown automatic preflight never calls `spawn`.
- Unit tests prove stopped automatic recovery still starts and a supervisor
  winner during exit grace returns success.
- Workspace/source contracts prove automatic and manual request shapes differ,
  recovering/deferred states suppress only the daemon-offline/start-error
  banners, and bounded exhaustion restores them.
- Focused app/API tests, typecheck, test wiring, and a native Tauri smoke prove
  the final behavior without disturbing the running user daemon.

