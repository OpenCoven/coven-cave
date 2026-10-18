# Native recovery development evidence — 2026-10-18

This follow-up to [#6069](https://github.com/OpenCoven/coven-cave/issues/6069),
[#5766](https://github.com/OpenCoven/coven-cave/issues/5766) and
[#5767](https://github.com/OpenCoven/coven-cave/issues/5767) retains a complete
native live-send rerun on source `2d623fcf3744ef0ca960cc7ffd22256e2860e9a8`,
Next build `RmbJx8XNjDdNt1HhIXIqA`. This is a development build. Val has not
nominated it as a release candidate or accepted the final bounded packet.

The [real-daemon lane](live-recovery.json) passed actual composer send,
termination, server restart, persisted-history hydration, two output reads and
dismissals, background return, ordering and the original `tool.isHittable`
assertion. The harness exited 0 with one provider request and one controlled tool
invocation. It verified stable message IDs, unchanged source fingerprint and
server/provider/daemon cleanup. The external Hermes provider is synthetic.

The [historical failure](../runtime-activity-2026-10-18/native-live-failure.json)
remains failed. It did not reproduce on this development build. No product or
test assertions changed, and no root-cause fix or elimination of intermittent
failures is claimed.

[Supporting tests](verification.json) passed the older background/output
regression and three Debug fixture journeys: local choices through completion
and background, cold/repeated open, and shrinking-content recovery plus reopen.
The first navigation run showed pairing instead of the fixture and skipped the
Performance suite. A retry reinstalled only this session's simulator app and
explicitly selected the skipped tests in a temporary plan. All attempts remain
in the [ledger](attempts.json), including disk-pressure interruptions and the
[live setup failure](live-setup-failure.json).

[Identity](identity.json) records source, build, executable digests, runtime,
client and host versions. [Commands](commands.txt) retain exact invocation and
retry boundaries. The [running](live-running.png) and
[recovered](recovered-after-background.png) screenshots contain synthetic data
and were inspected. Raw logs and xcresult bundles are identified by digest;
permanent hosting of raw local artifacts is not promised.

This packet does not rerun all 114 entries, desktop navigation, a real provider,
physical remote ingress, human VoiceOver or physical-device Release performance.
The Debug fixtures are behavior checks. Approval and change authority stays
unavailable. The original acceptance inventory and its support gates remain
unchanged. #6069, #5766 and #5767 remain open for their complete criteria.

Next: nominate the exact next candidate commit/build, rerun the complete packet
before rollout, and obtain Val's explicit acceptance. Keep human/device and
provider gates separate. The original evidence checkout remains preserved; all
daemon state used scratch roots. The owned simulator was shut down. The issue
comment records local worktree ownership and delivery status separately.
