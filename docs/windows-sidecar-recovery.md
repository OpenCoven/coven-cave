# Windows sidecar recovery in the loaded app

After the app opens, the native host continues to own the packaged Node sidecar.
The loaded shell listens to `sidecar-startup-progress` and reads
`sidecar_startup_status` after subscribing. These are native IPC operations, so
they do not depend on the failed Next server answering an HTTP request.

The shell shows preparation/startup progress and a failure or cancellation
banner with **Retry** when the native status permits it. The last failure stays
visible and actionable through the supervisor's cooldown. There is no fabricated
countdown: the native protocol currently has no distinct cooldown phase.

Retry calls `retry_sidecar_startup` once per pending command. The existing
`SidecarStartupControl` remains the single-worker gate for both manual startup
and automatic revival. Accepting the command is not proof of readiness. Native
progress/status drives the banner, and `ready` removes it. The native host still
owns authenticated readiness, token/origin replacement, window navigation,
backoff, cancellation and shutdown; the frontend neither resets the budget nor
replays chat or other application mutations.

An unused native startup controller reports `idle`, so a healthy Windows
development window using an external dev server stays quiet. Actual packaged
startup explicitly publishes `preparing`. The listener is Windows-only. Browser, macOS and mobile clients do not invoke
these commands. A newer event takes precedence over an outstanding status query,
and leaving the shell disposes its listener and banner. A failed monitoring
connection provides guidance to reopen Cave; it does not falsely declare the
sidecar ready or start a service without an authoritative retryable status.

## Verification and limits

`src/components/sidecar-recovery.behavior.test.tsx` exercises the real React
trigger, shared banner store and Tauri JavaScript event/command adapters with
controlled native IPC. It covers initial snapshots, live events, stale queries,
Retry admission, command errors, platform exclusion and disposal.
`tests/sidecar-recovery.spec.ts` exercises the production shell with controlled
IPC, including narrow/wide layout and keyboard Retry. These fixtures do not
prove Windows process or webview behavior.

Real Windows qualification remains a separate acceptance gate under
[#5981](https://github.com/OpenCoven/coven-cave/issues/5981):

1. Use a disposable Windows profile/installation with synthetic Cave state and
   record the exact app binary, source, cache paths, port and owned child PID.
   Do not kill another installation's process or alter user caches.
2. Open the packaged app, establish readiness, then terminate only its verified
   Node child. Observe the still-loaded shell's recovery banner and native
   automatic revival, including navigation with fresh authentication.
3. With a controlled startup failure, exhaust the automatic burst. Confirm the
   banner retains Retry during cooldown. Restore the prerequisite and select
   Retry; verify one startup worker, a usable reconnected app and cleared banner.
4. Exercise Retry concurrent with automatic revival and application shutdown.
   Verify no duplicate worker, leaked owned child or false ready state. Retain
   native logs and the first failed observations.

A destroyed or unreachable webview cannot display a React banner; the existing
native navigation fallback remains responsible for that case. This change does
not add a persistent offline UI, change installer/UAC behavior, reclaim runtime
generations or qualify the entire issue.

Rollback is a scoped code revert of the shell trigger and its wiring. No data
migration, cache deletion, native retry-policy change or dependency change is
required.
