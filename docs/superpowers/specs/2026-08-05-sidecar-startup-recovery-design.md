# Sidecar Startup Recovery Design

## Problem

Packaged macOS launches can exceed the current 20-second sidecar readiness
deadline. The GUI then exits through the fatal startup path while its Node child
continues running. Repeated launches accumulate orphaned sidecars, and every
sidecar writes to the same `sidecar.log`. Later launches truncate that shared
file while older processes still hold write handles, producing sparse,
interleaved logs and unreliable readiness evidence.

The observed failure left five orphaned packaged sidecars. The sidecar for the
reported port eventually listened and wrote the expected ready marker after the
GUI had already reported a timeout.

## Design

### Isolate startup evidence

Create a distinct log file for each launch using the selected port and parent
process ID. Readiness checks and timeout diagnostics use only that launch's
file. Existing sidecars can no longer erase or interleave the marker for a new
launch.

### Allow realistic packaged cold starts

Increase the non-Windows readiness deadline from 20 seconds to 60 seconds.
Windows retains its existing 90-second allowance because runtime extraction and
endpoint scanning make its startup profile different.

The readiness condition remains unchanged: the selected port must accept a
connection and the launched sidecar must write the exact ready marker. A longer
deadline therefore does not weaken the port-squatting defense.

### Reap failed children before fatal exit

When synchronous non-Windows startup fails, stop and wait for the child stored
in `SidecarState` before calling the fatal exit path. This cleanup must happen
for timeout and other post-spawn failures. Cleanup errors should be included in
the fatal diagnostic rather than silently ignored.

## Error Handling

Log creation remains best-effort, matching current behavior. If the log cannot
be created, stdout and stderr stay null and the timeout diagnostic reports that
the log could not be read.

Failure cleanup is bounded by the existing child termination implementation.
The original startup error remains primary; any cleanup failure is appended as
additional evidence.

## Testing

1. Verify launch log paths differ by port and process ID.
2. Verify readiness still requires both the exact marker and a listening port.
3. Verify the non-Windows startup error path invokes child cleanup before fatal
   exit through a small testable helper.
4. Run the targeted Rust lifecycle tests and the source-contract tests that pin
   sidecar readiness behavior.

## Scope

This change does not add a single-instance plugin, alter background reachability
ownership, or terminate unrelated existing sidecars. Those are separate
lifecycle concerns and are not required to prevent this failure from recurring.
