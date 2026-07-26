# Grouped Eval Stale State Design

## Goal

Let Cave answer two operational questions for familiar evals:

- Is this thread's eval state fresh, stale, running, blocked, or never run?
- Which grouped thread evals should a human run or review next?

Phase 1 and Phase 2 ship stale-state verification, manual grouping, and manual queueing. Safe automation is tracked separately on the internal Coven board as `Phase 3: Automate grouped thread eval scheduling safely`.

## Data Model

`ThreadEvalSnapshot` records what an eval covered: thread, familiar, optional group, evaluated-through turn, input hash, rubric versions, skill/permission fingerprints, response-confidence event ids, and evaluation time.

`ThreadEvalCurrent` represents the current thread reality. `deriveThreadEvalState` compares snapshot versus current and returns:

- `never-run` when no snapshot exists
- `running` when a fresh eval lock exists
- `blocked` when a stale eval lock exists
- `stale` when turns, hashes, rubrics, skills, permissions, confidence events, group definition, or TTL changed
- `fresh` when none of those checks report drift

Each state also includes a `details` object so the UI can show the evidence behind the status: latest turn, evaluated-through turn, current/snapshot rubric versions, confidence event counts, group update time, and TTL.

## Grouping And Queueing

`EvalGroup` groups thread/familiar/project/filter members with tracks and a stale policy. Phase 2 supports manual groups and a manual queue. `rollupEvalGroup` summarizes fresh/stale/running/blocked/never-run counts and identifies runnable thread ids. `buildManualEvalQueueItems` queues stale and never-run threads, skipping blocked/running/fresh ones.

Automation is intentionally deferred. The queue model is the stable seam for a later scheduler.

## UI

The Evals surface loads suites, groups, thread snapshots, runs, and queue state. The group panel shows:

- group freshness rollup
- one row per thread eval state
- stale reasons
- reviewable freshness evidence for each thread
- a manual `Run stale evals` action

Thread Signals now starts with a review queue before the broad breakdown. The queue ranks persistent blockers, access gaps, blocking capability gaps, context pressure, skill clarity gaps, and low scores so the summary is easier to scan.

## Safety

- Eval snapshots and groups are stored under the existing local eval store.
- File names are id-sanitized and writes use the atomic JSON helper.
- The queue is manual only in this phase.
- Automation must keep budget, concurrency, debounce, and lock-safety guardrails before it is allowed to enqueue without a human click.

## Verification

Focused tests cover:

- stale/fresh/running/blocked/never-run derivation
- stale reasons and detail evidence
- group rollups and manual queue construction
- eval store persistence for groups, snapshots, and queue items
- Evals view source wiring for groups, states, and detail rows
- Thread Signals review queue ranking and source wiring
