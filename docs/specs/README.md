# Frozen — closed to new files

New design and plan documents go in [`../superpowers/specs`](../superpowers/specs)
and [`../superpowers/plans`](../superpowers/plans). Nothing new belongs here.

The 55 files already in this directory **stay where they are**, permanently.
They are not scheduled for migration and should not be moved.

## Why frozen rather than migrated

Beads cite these files **by path**, and one of those citations is on live work:
`cave-ltl38.6` ("Connect conversation checkpoints to exact code evidence")
carries a structured `Spec:` field pointing at
[`2026-07-03-unified-chat-code-workspace-design.md`](2026-07-03-unified-chat-code-workspace-design.md).
It is open, sits under the `cave-ltl38` epic, and blocks two further units.
Moving that file breaks the field.

Fifteen more of these files are cited by closed beads, where the path is the
provenance trail for work that already shipped. Moving them severs that trail
for no benefit: the two stores hold **disjoint** content — not one slug appears
in both — so there is nothing here to deduplicate. A migration would buy
tidiness and cost correctness.

## What changed, and when

This directory is the earlier convention: design and plan documents interleaved
in one flat tree, 28 `*-design.md` beside 22 `*-plan.md`. The `superpowers/`
store that replaced it separates the two — `specs/` holds the design, `plans/`
holds the implementation plan derived from it — and states that contract in
[its README](../superpowers/README.md). `AGENTS.md` cites `superpowers/` as
authoritative; nothing in `AGENTS.md`, `CLAUDE.md`, or `CONTRIBUTING.md`
mentions this directory at all.

The two ran in parallel from 2026-06-30 to 2026-08-06. That overlap is why the
boundary needed writing down.

## Three files here are not point-in-time records

These are standing contracts with no date in the name, and they do not expire
the way a dated spec does:

- [`double-blind-eval.md`](double-blind-eval.md)
- [`ios-new-chat-project-contract.md`](ios-new-chat-project-contract.md)
- [`research-generations-media-contract-v2.md`](research-generations-media-contract-v2.md)

They stay here for the same path-stability reason as everything else. Read them
as current unless the contract they describe has been superseded in code.
