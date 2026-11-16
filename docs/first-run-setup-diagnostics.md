# First-run setup diagnostics

The first-run bootstrap reports failures with a stable server-classified code
and a versioned, display-safe diagnostic snapshot. The client never parses
installer prose to infer a cause. In particular,
`application_data_not_writable` is used only when a disposable file probe in
the Cave-owned target actually fails; download, integrity, archive, busy,
timeout, filesystem, platform, and post-install verification failures keep
their own recovery guidance.

`GET /api/onboarding/bootstrap` is the read-only source for the current setup
state and its optional diagnostic snapshot. Opening or copying diagnostics does
not call the bootstrap mutation route, enter the shared install lane, or change
resume state. `POST` remains the only confirmation/resume path, and completed
stages remain skipped on retry.

## Safe snapshot boundary

The persisted snapshot is an allowlist, not a projection of the install job. It
may contain the failed stage, stable code, canned summary and next step, capture
time, Cave version, platform/architecture, symbolic application-data location,
write-probe outcome, component readiness, and a bounded installer summary. It
must never contain raw `Error` objects, environment dumps, authorization
headers, credentials, URL query values, usernames, home paths, arbitrary
filesystem paths (including UNC and host-based `file:` URLs), or terminal
control sequences.

Installer output is sanitized centrally, then bounded independently from
lifecycle trace facts so a long stdout/stderr tail cannot erase the useful
installer state. Persisted snapshots are rebuilt from the same strict contract
when read, which drops unknown fields and re-sanitizes output before the local
status API returns it.

## Application-data folder action

The diagnostics modal intentionally does not offer an “Open application-data
folder” action. Cave has a native path-opening command, but the current desktop
capabilities do not authorize this first-run surface to use it. Adding the
action would require widening native permissions and exposing a raw local path,
which is outside this diagnostic feature’s security boundary.

## Local service failures

The daemon stage retains the startup result's stable failure code, launch mode,
readiness-attempt count, elapsed time, and exit code. These facts survive saved
state reload and appear in both the modal and copied report. Recovery guidance
is selected from the stable code; raw daemon errors, stdout, and stderr are not
persisted. Unknown service codes and extra fields are discarded on read.

On a service failure, setup rechecks component readiness and directory existence.
It does not run a write probe for a service failure, so “Not run” remains accurate.
If a diagnostic check fails, its value stays unknown without replacing the
original service failure. Older snapshots without service facts remain readable;
retry setup to capture new facts.
