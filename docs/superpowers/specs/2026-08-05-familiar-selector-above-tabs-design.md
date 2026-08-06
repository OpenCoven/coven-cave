# Familiar selector above Home and Chat tabs

**Status:** approved for implementation review  
**Date:** 2026-08-05  
**Bead:** cave-3pnnq  
**Surfaces:** Home composer and Chat

## Goal

Establish the active familiar before a user selects a Home destination or Chat
section. Both surfaces will show the existing familiar selector in a dedicated,
full-width row immediately above their tab row.

## Current baseline

- Home renders `FamiliarQuickSwitch` in the composer footer, below the inline
  Chat and Task destination tabs.
- Chat renders its Sessions, Projects, Canvas, and Familiar tabs at the top of
  the surface, but relies on the Chat sidebar for familiar selection.

The selector is already the shared, accessible familiar menu and owns all
selection behavior. This change only changes its placement and wires the
existing selection callback into Chat.

## Decision

### Home

Move the existing `FamiliarQuickSwitch` out of the footer context-chip cluster
into a dedicated full-width context row directly above the Chat and Task tabs.
It remains a single-familiar selector with the same menu placement and
selection callback. Project, runtime, and model controls remain in the footer.

### Chat

Add the same full-width `FamiliarQuickSwitch` context row directly above the
Sessions, Projects, Canvas, and Familiar tabs. It uses the current active
familiar, familiar roster, live sessions, and `onSetActiveFamiliar` callback.
Selecting a familiar preserves the current Chat section; it does not reset a
tab, start a session, or change the existing sidebar behavior.

### Responsive behavior

The selector and tabs remain vertically stacked at all widths. The selector
fills its own row; the Chat section tabs retain their existing horizontal
overflow behavior and mobile sticky treatment. No new breakpoints, state, or
menu variants are introduced.

## Component boundaries

- `HomeComposer` owns the Home placement only. It continues to use
  `FamiliarQuickSwitch` with `singleRequired`.
- `ChatSurface` owns the Chat placement and forwards the existing active
  familiar state to `FamiliarQuickSwitch`.
- Existing switcher components continue to own menu rendering, focus,
  selection, presence, and responsive menu placement.
- Surface CSS provides only the layout row and token-based spacing/borders.

## Accessibility and error handling

- The existing switcher remains a native button with its current accessible
  name, dialog semantics, focus ring, focus handling, and keyboard behavior.
- The row must not obscure the Chat tabs' tablist labeling or keyboard
  navigation.
- A missing active familiar retains the switcher's current "Choose familiar"
  state; no selection is synthesized.
- Familiar loading and selection errors retain their existing surface behavior.

## Verification

1. Targeted source tests assert Home renders the shared selector before its
   destination tab group and no longer renders it in the footer.
2. Targeted source tests assert Chat renders the selector before its section
   tabs and wires selection through `onSetActiveFamiliar`.
3. Existing Home composer and Chat surface tests continue to cover destination
   and section tab contracts.
4. A real-app check confirms the stacked hierarchy on Home and Chat at desktop
   and narrow widths, including opening the selector and switching familiars.

## Non-goals

- Changing familiar menu content, selection semantics, presence, or
  multi-select behavior.
- Moving the sidebar selector or changing Chat's sidebar structure.
- Changing Home's project, runtime, model, or destination behavior.
- Adding a new familiar-selector component or new persisted preferences.
