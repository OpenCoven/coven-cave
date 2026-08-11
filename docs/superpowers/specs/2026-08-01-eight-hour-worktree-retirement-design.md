# Eight-Hour Worktree Retirement Design

## Goal

Reduce the mandatory branch/worktree retirement recency window from 24 hours to
8 hours while preserving every other deletion safeguard.

## Scope

This change applies only to local branch and worktree retirement eligibility.
It does not alter unrelated 24-hour limits such as API caches, stale PR
defaults, attachment retention, session resources, or maintenance-gate lease
limits.

## Policy

A clean, landed lifecycle unit remains in `cooldown` until its authoritative
recency timestamp is at least 8 hours old. At exactly 8 hours it may enter
`retire-after-gate`.

`retire-after-gate` is not deletion authorization. Removal still requires:

- complete ownership, PR, workflow, task, reflog, and recovery evidence;
- the repository-wide maintenance transaction;
- the normative final deletion proof; and
- successful post-action verification.

Recovery, WIP, dirty, active, protected, unlanded, divergent, or uncertain
units remain preserved regardless of age.

## Implementation

Replace the lifecycle classifier's day-based threshold with one named
`RETIREMENT_COOLDOWN_MS` constant set to 8 hours. Use that constant in both
metadata-aware and legacy classification paths and update their human-readable
reasons.

Align the binding policy surfaces:

- lifecycle unit tests and patrol integration tests;
- branch-curator guidance and deletion proof;
- branch-curator evaluation fixtures; and
- the current automatic-retirement design documentation.

Historical or unrelated documents that happen to mention 24 hours remain
unchanged unless they define this retirement policy.

## Verification

Tests must pin both sides of the boundary:

- 7 hours, 59 minutes, 59.999 seconds remains `cooldown`;
- exactly 8 hours becomes `retire-after-gate`.

Run the lifecycle unit test, patrol integration test, branch-curator skill
validation if available, typecheck, and test-wiring checks.
