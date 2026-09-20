# Authorized interface redesign handoff — 2026-09-20

## Source and scope

For [#5453](https://github.com/OpenCoven/coven-cave/issues/5453), Val supplied
`cave-interface-redesign-handoff.zip` and instructed: “use this instead.”
This replaces the live-project requirement for this reconciliation only.
It does not approve every proposed behavior or reopen deferred implementation.

Archive SHA-256:
`9db832c0c99af0d686d575161754a7b006dff5a1036be9d5b751710884a52e90`.
[manifest.json](manifest.json) records all 22 entries, byte sizes, and hashes.
The four principal documents are retained byte-for-byte under `source/`:

- [Coven Cave Prototype.dc.html](source/Coven%20Cave%20Prototype.dc.html)
- [Coven Cave Redesign Spec.md](source/Coven%20Cave%20Redesign%20Spec.md)
- [Coven Cave Redesign.dc.html](source/Coven%20Cave%20Redesign.dc.html)
- [CovenComposer.dc.html](source/CovenComposer.dc.html)

These are reference sources, not a runnable app or a production dependency.
Supporting runtime bundles, export README, SVG, and screenshots remain in the
original archive; their hashes are recorded without copying them into the repo.
No screenshot or live-project visual acceptance is claimed here.

The archive contains **none** of the original issue's `Design Board v2`,
`Familiars Redesign v2`, or `ReasoningCard v2` frames. Their live project URL,
contents, and implementation status remain unverified. They must not be marked
landed or treated as equivalent to these four documents. The supplied Redesign
also differs byte-for-byte from the older repository snapshot under
`../coven-cave-ui-redesign/project/`; that snapshot remains unchanged.

## Reconciliation against main

Inspected base: `98640f0a6ec87f1d872938642331847564502389`.
This is a source and implementation audit, not a new visual or performance run.

| Supplied document | Existing implementation | Remaining disposition |
| --- | --- | --- |
| Redesign, Turn 1 frames 1a–1d | `src/lib/session-lifecycle.ts`, status tokens in `src/styles/globals/foundations.css`, branch middle truncation, and sidebar attention vocabulary cover the Phase 1 foundation. | Partial. Home, palette consolidation, density, and handoff-specific title semantics remain deferred by #5414. Turn 2's second token/icon system is not adopted. |
| Prototype, frame 2c | `src/components/needs-you-popover.tsx`, `needs-you-panel.tsx`, and `src/lib/needs-you-inbox.ts` implement the actionable Needs-you inbox; #5411 is its landing receipt. | Preserve the existing measured, session-backed implementation and local-device Seen semantics. This does not establish fidelity to every byte of this newly supplied export. |
| Prototype, frames 2a, 2b, 2d | Existing Home, chat, run rail, and command palette overlap the mock screens. `src/components/chat-run-rail.tsx` deliberately excludes unmeasured panels. | The remaining Home/removal negotiation, palette layout, and extra context panel were explicitly deferred by #5414. Synthetic prototype metrics, costs, approvals, and streaming timers are not runtime evidence. |
| CovenComposer | The landed `Composer.dc.html` adaptation in `src/components/chat-view.tsx` and the separate `src/components/coven-composer-bar.tsx` predate this frame. Existing context, voice, tools, and send controls are real. | Distinct, outstanding, deferred by #5458/#5414. Its three bands, destination ladder, familiar/branch pickers, keys dialog, and context popover do not prove the single-composer direction shipped. Mock connector choices, modes, and context-budget breakdowns must not become invented runtime state. |
| Redesign Spec | The status foundation and Needs-you inbox overlap delivered work. First-exchange naming, periodic auto-renaming, and on-demand generation already exist; see `src/lib/chat-title-generation.ts` and `src/lib/chat-auto-rename.ts`. #5435/#5434 established browser render skipping for 200 rows. | Neither “title generation is entirely unbuilt” nor “list rendering is untouched” is accurate. The full stable-first-prompt/issue-title rule is not established; existing manual-title ownership and longer explicit subject lines must survive. Render skipping is not DOM windowing or proof of memory, latency, or 60fps budgets. |

Authoritative scope decision:
[#5414 closure](https://github.com/OpenCoven/coven-cave/issues/5414#issuecomment-5694561288).
It defers discretionary redesign, preserves existing features, and requires a
demonstrated core-user need or measured regression before a narrow follow-up.
Supplying this archive changes source availability, not that implementation gate.
The spec's user studies, drawer-composer usage threshold, and attention-badge
experiment remain unperformed acceptance work, not evidence for deletion.

## First bounded candidate, if the deferred work is reopened

The original requested ReasoningCard/held-action slice cannot be scoped from
this archive: neither source frame is present. Do not fabricate those designs
or introduce an approval action without a verified execution contract.

The supplied spec §3 instead exposes a small frontend-only candidate:
**keyboard-accessible full session metadata**. Current `ChatRowTitle` provides
the full title to assistive technology and a native title tooltip, while
`chat-list.tsx` middle-truncates the branch and uses Enter/Space to open the row.
It does not implement the spec's inline metadata expansion. The spec's Space
binding conflicts with the existing button activation and drag interaction.

If a concrete user need justifies reopening this work, scope it as follows:

1. Add a separately focusable disclosure for full title and already available
   branch/project metadata in Sessions. Preserve Enter/Space row activation,
   selection mode, nested quick actions, and the drag handle. Do not add an
   unbacked first-prompt preview or fetch every transcript for list metadata.
2. Reuse current tokens, focus rings, and reduced-motion behavior. Announce
   expanded/collapsed state; preserve focus when collapsing.
3. Verify long titles/branches, missing metadata, keyboard navigation,
   selection, drag cancellation, filtering/grouping, and the existing 200-row
   render-skipping fixture. Record human keyboard/screen-reader acceptance
   separately from automated coverage.

This is a proposed slice, **not authorized implementation or a new task claim**.
Reopen #5414 or its scoped successor only with the required need/approval;
reuse existing ownership rather than creating a duplicate redesign queue.
The Home removals, single-composer migration, new title engine, and unmeasured
run panels are excluded. Review Desk and generic Comms remain retired under
#5412; X Comms remains supported.
