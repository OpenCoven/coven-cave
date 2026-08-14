# Runtime startup supervision

Cave treats a reachable socket as transport availability, not as runtime
readiness. A local Coven daemon is adopted only after `/api/v1/health` reports:

- a supported named API (`1` or `v1`);
- a valid Coven SemVer value; and
- the exact same version as the installed Coven command Cave manages.

If that contract is not met, Cave returns `runtime_incompatible` from daemon
start and `incompatible` from daemon status. It does not restart an already
reachable incompatible daemon automatically; that could allow an older process
to open newer persisted state. The recovery action is to update or repair
Coven, then restart the daemon.

`config.json` and `state.json` are also fail-closed. A missing file starts with
the documented defaults, but malformed files and configuration versions newer
than Cave supports remain untouched and produce an actionable error. This keeps
a routine settings or session write from replacing migrated data with empty
defaults. Restore a backup for malformed data, or update Cave for a newer
configuration version.

An address someone else already holds is its own outcome rather than a generic
early exit. Once the health probe has failed, Cave connects to the daemon
address to learn whether anything is accepting there; a completed connection
means the occupant is something Cave cannot adopt, so the start is refused with
`address_in_use` and no launcher is spawned. Only a proven connection refuses —
a refused or absent socket launches, and an address that cannot be read at all
stays unknown and launches too, because a false refusal strands a user whose
socket is merely unreadable. A restart skips the check entirely: the occupant it
would find is the daemon the caller asked to replace. The launcher's own bind
failure is classified the same way, which closes the window between the check
and the bind. Cave never deletes a socket file to clear the address; removing
one a live owner still holds is how two daemons come to believe they own the
same home.

The daemon starter retains its bounded health deadline and owned-process-tree
cleanup. A launcher exit alone never means ready; the final readiness probe must
pass the runtime contract before Cave reports success.

To prevent restart storms, concurrent ordinary start requests share one launch.
After three failed managed launches in one minute, Cave pauses new launches
until the rolling window expires and returns an actionable retry time. A healthy
readiness handshake clears that failure history. Test seams bypass this
process-wide guard so isolated lifecycle tests cannot affect production state.
