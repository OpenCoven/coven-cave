# Bounded process-group observation

> Use superpowers:executing-plans inline with one independent final review. Checkbox state is not completion evidence; verified code and merged PRs establish completion. Issue #6147 owns the work record.

**Goal:** Keep a transient Darwin zombie-group permission error from prematurely failing the existing shutdown wait, while preserving conservative cleanup and failure reporting.

**Spec:** https://github.com/OpenCoven/coven-cave/issues/6147, under #6119.

**Architecture:** Reuse one bounded observation helper in shutdown and cleanup. A permission error is uncertainty, never absence or permission to signal. Only a later definitive absent result clears it. Forget confirmed-absent IDs immediately. Preserve existing descendant containment, deadlines and report classifications; numeric POSIX groups still lack an atomic identity guarantee.

**Files:** `scripts/daemon-lifecycle-probe.mjs`, its existing test file, this plan, and `docs/performance/daemon-lifecycle.md`, which owns the probe's evidence and limitations.

**Review focus:** Persistent or mixed uncertainty must fail. No signal may follow an unknown observation. Retired IDs must never be inspected or signaled again. A launcher exiting with a surviving descendant must remain tracked. Keep all failed native samples and do not claim that this fixes the original daemon startup failure.

- [ ] Add behavioral regressions for transient permission uncertainty, persistent/mixed uncertainty, confirmed-absent ID retirement and command completion. Observe their intended failures against current code.
- [ ] Implement the smallest shared bounded wait and retirement changes; preserve existing two-second observation budget and escalation policy.
- [ ] Run the existing complete probe suite and related startup contract checks; inspect diff and required scoped repository gates.
- [ ] After heavy builds finish, repeat the isolated exact-binary native exercise and retain both the failed and corrected reports. Record runtime and ownership limits.
- [ ] Obtain one independent review, verify the exact PR head and land through protected checks. Preserve the worktree and evidence; no release or deletion.
