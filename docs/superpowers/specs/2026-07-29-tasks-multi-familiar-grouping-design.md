# Tasks multi-familiar grouping

## Problem

The Tasks header currently shows its **Familiar** grouping option whenever
`activeFamiliarId` is `null`. That state represents both **All familiars** and a
multi-familiar shell selection, so the page exposes redundant familiar chrome
while the shell is already providing the only scope the user selected.

## Design

Treat the shell's selected-familiar set as the source of truth. The Tasks and
Gantt grouping controls show **Familiar** only when
`scopeFamiliarIds.size > 1`. They hide it for the unscoped **All familiars**
state and for a single selected familiar.

If a persisted grouping preference is `familiar` while the control is hidden,
Tasks renders the existing safe fallback:

- status grouping for Kanban and Table
- project grouping for Gantt

Task filtering, task assignment controls, and the shell familiar switcher do
not change.

## Verification

Extend the existing Tasks familiar-scope source-contract test to pin the shared
multi-selection predicate, both conditional controls, and both persisted-value
fallbacks. Run that focused test first, then the relevant app, type, and design
gates.
