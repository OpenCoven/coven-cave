# Orchestration-Ready Tasks

**Date:** 2026-08-03 · **Applies to:** every familiar, surface, and orchestrator
that reads or writes a Cave task
**Design spec:** [`superpowers/specs/2026-08-03-orchestration-ready-task-shape-design.md`](./superpowers/specs/2026-08-03-orchestration-ready-task-shape-design.md)

This is the shared operating contract for Cave tasks. The spec explains *why* and
*how it lands*; this page is what a familiar needs to behave correctly around the
task shape. Read it before writing anything that creates, blocks, unblocks, or
dispatches a task.

Status: approved design. The fields described here are the target contract, not
yet shipped — until they land, treat this as the shape to design toward and do
not invent a competing one.

## The one rule

**A blocked task must say what blocks it and what happens next.**

Concretely, every task in `blocked` carries all three:

1. At least one **unresolved dependency**.
2. A **primary blocker** — one of those unresolved dependencies, named.
3. A **next step** — one imperative action.

A task that cannot state all three cannot be newly written as blocked; the write is rejected as incomplete.
This is enforced on the server, on every write path, so there is no way to route around it — including from Enhance.

## Dependencies

A dependency is anything unresolved that holds the task. It is typed, so a
reader can tell a waiting-on-a-teammate from a waiting-on-a-merge at a glance.

| Kind | Use for | Resolves when |
| --- | --- | --- |
| `task` | Another Cave task | That task reaches done |
| `github` | Issue, PR, check run, release | The referenced item closes or passes |
| `human` | A decision or approval owed by a person | The person decides, with a record |
| `credential` | A secret, key, or account that must exist | It is provisioned |
| `service` | An external system that must be reachable | It is reachable or provisioned |
| `execution` | A failed or cancelled run | Someone retries or repairs |
| `external` | Any other named, resolvable condition | Its stated condition holds |

Rules a familiar must follow:

- **Name the dependency in the imperative.** "Merge PR #4201", not "PR". The
  label is what an orchestrator shows a human at 2am.
- **Give external dependencies a stable reference.** `OpenCoven/coven-cave#4201`
  or `svc:tailscale`, not a sentence. Free text cannot be traced to the system
  that would resolve it.
- **Resolving requires evidence.** A merge URL, a run id, a decision record, a
  person's name. "Done" is not evidence.
- **Only `task` dependencies form the graph.** GitHub items, humans, and
  credentials are terminal blockers. They do not create cycles and they do not
  affect dependency depth.

Multiple dependencies are normal. Their **order is priority order** — that is
what promotion uses when the primary blocker clears.

## The primary blocker

Exactly one unresolved dependency is designated primary. It is the answer to
"what is actually holding this?" — the thing a human is asked about first and
the thing a status line shows.

- When the primary blocker resolves, the next unresolved dependency in order is
  promoted automatically and the derived next step is refreshed.
- Pin the primary blocker when the automatic order is wrong for a specific task.
  A pin survives promotion.
- When nothing unresolved remains, the task is recommended for unblocking. It
  does **not** leave Blocked on its own — that stays a deliberate act.

## The next step

The next step is a structured action, not prose, because an orchestrator has to
route it without a human interpreting it:

- **summary** — one imperative action, no conjunctions. "Rerun the failed e2e
  job", not "look into CI and maybe rerun it".
- **actor** — the familiar or person who should do it, when known.
- **capability** — the tool or skill it needs.
- **target** — the repo, path, project, URL, or session it lands on.
- **inputs** — anything the actor needs handed to it.
- **requiresApproval** — whether a human must say yes first.

### Approval is a hard boundary

`requiresApproval: true` means the step flags the task for a human, shows up in
Chart Room Decisions, and **cannot be auto-dispatched**. Automation may write
such a step. Nothing may execute it. If you are an orchestrator and the step
requires approval, your job is to present it, not to run it.

## Failures are blockers too

When a session fails or is cancelled, or retries run out, the Cave synthesizes an
`execution` dependency carrying the failure reason and a next step asking a human
to choose retry or repair. Failure-blocked and dependency-blocked are the same
contract — there is no second, weaker path into Blocked.

## What Enhance may and may not do

Enhance proposes dependencies and next steps. It **auto-applies only** when all
three hold:

1. Every reference it names resolves to something real.
2. The proposal passes full validation, including cycle and dangling checks.
3. It is not displacing something a human wrote.

Everything else waits in a recommendations queue. A model saying it is confident
is not one of the gates — the Cave applies changes it can verify itself, not
changes a model asserts are safe.

**Human authorship wins.** If you wrote a dependency or a next step, automation
proposes a replacement rather than overwriting you.

## Readiness

Readiness is derived on read; nothing stores it:

| State | Meaning | What to do |
| --- | --- | --- |
| `ready` | Nothing unresolved | Start it, or recommend unblocking |
| `waiting` | Valid unresolved blockers | Work the primary blocker |
| `incomplete` | Blocked but missing part of the triple | Repair it |
| `cyclic` | In a task-to-task cycle | Break the cycle before anything can start |

Tasks blocked before this contract existed stay readable and derive `incomplete`
with concrete repair recommendations. They are a cleanup queue, not an error.

## Coven alignment

Every familiar reads the same task record. Practical consequences:

- **Navigator (Chart Room)** — dependencies are canonical board data now, not a
  private overlay. Graph, Flow, Orchestration, Table, and Gantt all read the same
  edges, and so does every other familiar and device.
- **Any familiar blocking a task** — you owe the triple. Blocking without it is a
  rejected write, not a warning.
- **Any familiar resolving a blocker** — attach evidence, and let promotion pick
  the next one rather than hand-editing the primary.
- **Any orchestrator dispatching work** — route on the next step's actor,
  capability, and target. Honor `requiresApproval` absolutely.
- **Beads** — unchanged as the durable issue tracker. Cave tasks are the
  execution surface; a bead may reference a task and a task may reference a bead,
  but neither replaces the other.

## Quick reference

- Blocking something? Name the blocker, pick the primary, write the next step.
- Resolving something? Attach evidence.
- Automating something? Verify it, do not trust a confidence score.
- Dispatching something? Stop at `requiresApproval`.
