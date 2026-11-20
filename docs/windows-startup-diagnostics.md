# Windows startup diagnostics

The native host owns launch admission and recovery. A successful socket probe
alone does not establish readiness. This document covers #5979; it does not
qualify a Windows release or change sidecar retry/backoff or updater consent.

## Relaunch

The existing dedicated-port claim remains authoritative. A Windows launch that
loses that claim tries to activate the owner's main window for up to two seconds.
It requires the recorded PID, the same executable path, and a main-window
property carrying the exact resolved port. Window titles alone are insufficient.
Main windows are marked during registration, including secondary main windows.

Successful activation exits the second process without starting another sidecar.
Different `COVEN_CAVE_PORT` values remain supported. Missing identity, a window
not yet available, a different executable, or denied foreground activation keeps
the existing diagnostic path. No foreign process is stopped or adopted. The
bounded wait does not promise activation of older builds that lack the marker.

## Failures and retained evidence

Windows setup errors are handled inside the Tauri setup callback, before an
error can become Tauri's setup panic. The host requests owned-process shutdown
before exiting. A minimal copy of the executable receives bounded display text
through a private stdin pipe, waits for the failed host to exit, and then shows
a native message box. The helper enters before Tauri initialization and never
claims a port or starts workers. Transfer has a two-second deadline and parent
exit observation has a five-second deadline. Thus waiting for a user cannot
retain the failed host's port claims or kill-on-close process jobs. This surface
does not depend on WebView2, Next.js, or a console. The existing asynchronous Notepad diagnostic is a fallback if the helper
cannot be started or receive the message, or the message box cannot be shown. Errors from constructing/running the native app
also use a native-visible fallback.

Setup and sidecar failures attempt to append a structured event to
`daemon-diagnostics.jsonl` in Tauri's local application data directory. The
failure surface identifies the actual saved path. If a path cannot be resolved
or a write fails, it explicitly says that diagnostics could not be saved.
Very early native-app construction errors can precede resolution of this path.

The JSONL file is the release startup log. It is available independently of the
debug-only generic log plugin. It retains structured phases, classifications,
versions and correlation IDs rather than arbitrary raw log messages, tokens or
transcripts. The local failure surface still displays the actual error cause.

Relaunch preserves prior events. The file retains at most 256 KiB on complete
lines, with bounded reads of oversized existing files. A stable sibling
`daemon-diagnostics.jsonl.lock` coordinates replacement across processes.
Acquisition is nonblocking: a contended event may be omitted rather than stall
startup or overwrite another writer. Unreadable or nonregular diagnostic paths
are not treated as empty files. The lock is an OS-held handle; an old lock file
alone does not mean a process still owns it. Do not delete live diagnostic or
lock files as a recovery procedure.

Capacity messages use decimal MB, rounding available space down and required
space up. Packaged missing-Node guidance recommends reinstalling Cave; development
builds retain Node installation guidance. No cache schema or data migration is
introduced. A scoped revert restores the previous behavior without rewriting
user data; it also restores the previous loss of prior-launch diagnostics.

## Qualification

Host-platform tests cover message formatting, diagnostic retention, bounded
storage, lock contention, redaction and selection rules. Source contracts check
native wiring. They do not prove Windows compilation, foreground policy,
WebView2 failures, or physical-machine startup behavior.

The `windows-native` job in `.github/workflows/full-validation.yml` includes an
exact-count hidden native-window test for discovery by owner and port. It does
not request foreground focus. A second exact-count test builds the native app
and sets `COVEN_STARTUP_DIALOG_TEST_EXE` to that executable. It launches an
owned synthetic host, verifies its port claim stays locked while alive, then
verifies host exit releases the claim while the separate native error dialog
remains visible. The host also owns a worker through a kill-on-close Job Object;
its termination is checked while the helper remains visible. An outer fixture
job owns the complete test tree before child creation so failed assertions do
not leave a dialog behind. This supplements the existing descendant-cleanup
test; it does not establish packaged foreground acceptance.
Run Windows library tests with that variable set to the freshly built app;
the lifecycle test intentionally fails when its executable is unavailable.
The runtime matrix separately exercises Windows
archive preparation after building the bundled sidecar.

For native-source pull requests, `.github/workflows/windows-startup.yml` builds
the Windows executable and runs these startup tests plus diagnostic retention
and preparation-message cases. It uses a read-only token, exact test counts,
and no release or signing operations. The separate ordinary CI step named
“Windows startup controls” still runs Node conformance, not Rust compilation.
The PR lane supplies pre-merge native evidence; signed release-candidate and
packaged hardware qualification remain separate gates.

After the required Windows run is authorized, retain the exact commit/artifact,
Windows version, test counts, failed attempts and logs. Use disposable profiles
and a test machine/VM for fault injection:

1. Launch the packaged app, minimize it, then launch the same copy again from
   Start. Verify the existing window is restored/focused and no second sidecar
   is started. Repeat with an existing secondary main window.
2. Launch deliberate copies on two explicit different ports. Verify both remain
   independent and relaunch targets the requested port.
3. Exercise foreign ownership and an unavailable/older window. Verify bounded
   diagnostic fallback without stopping or activating an unrelated process.
4. On an authorized disposable VM, induce a WebView2/setup failure. Verify the
   native dialog names the cause even when no webview can render.
5. Trigger a sidecar failure and verify the failure surface names an existing
   diagnostic file. Relaunch and verify earlier failure events remain. Exercise
   unwritable diagnostic storage and verify the UI does not claim a saved log.
6. Exercise low-space preparation and missing bundled Node. Verify accurate
   units/remediation and no partial cache activation.

Keep #5979 open until its original acceptance has supporting Windows evidence.
