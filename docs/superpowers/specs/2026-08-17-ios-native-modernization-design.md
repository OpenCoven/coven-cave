# Native iOS Modernization Design

**Date:** 2026-08-17 · **Bead:** `cave-mwehk` · **Status:** approved direction; implementation plan pending review

## Goal

Make Coven Cave on iPhone and iPad feel like one calm, current native product
without changing its behaviour, server contracts, or iOS 18 deployment floor.
The app should retain the Cave’s distinct presence while making hierarchy,
reading, actions, and state more legible in the surfaces used every day.

This is a native-first refinement, not a desktop replica and not an iOS 26-only
Liquid Glass rewrite. The existing `Glass` system remains the compatibility
layer; it earns its place on navigation and transient controls rather than
obscuring working content.

## Current-state diagnosis

The app already has strong ingredients: desktop-backed `ChromePalette`, an
accessibility-aware glass implementation, haptics and motion discipline in chat,
and broad native coverage. Its visual debt is inconsistency rather than absence:

- Chat and navigation read as deliberately composed glass surfaces, while Tasks,
  Settings, Search, and several Familiar flows retain denser stock `List` and
  `Form` presentation.
- Theme semantics mix server palette roles with locally hard-coded presence,
  task-status, and priority colours. That can drift from the current desktop
  theme and makes contrast tuning scattered.
- Fixed-size typography in navigation and familiar chrome does not consistently
  participate in Dynamic Type.
- Secondary actions are often visually equal to primary work, weakening the
  first-glance path through a screen.

## Design direction

**Warm precision.** Content sits on quiet, token-derived surfaces. One primary
action anchors each screen; supporting actions recede into compact, tactile
chrome. Status is communicated with text and iconography as well as colour.

**Structured translucency.** Use the established `Glass` components for the
navigation drawer, compact toolbars, composer controls, search controls, and
ephemeral status. Do not put long-form chat, task rows, settings content, or
forms behind a glass layer. Existing reduced-transparency and increased-contrast
behaviour is a required part of every new treatment.

**Native hierarchy.** Prefer SwiftUI’s navigation, semantic text styles,
materials, and list interaction conventions. On iPhone, bottom-reachable primary
work wins. On iPad, preserve a stable navigation/context split while allowing
content width to read comfortably.

## Semantic visual system

`ChromePalette` remains the single source for the desktop-derived theme. Extend
the iOS theme layer with named semantic roles rather than passing raw colours
through views:

| Role group | Roles | Use |
| --- | --- | --- |
| Content | `canvas`, `surface`, `surfaceRaised`, `separator`, `textPrimary`, `textSecondary`, `textTertiary` | All screen and row hierarchy |
| Action | `accent`, `accentMuted`, `onAccent`, `focus` | Primary action, selection, keyboard/focus feedback |
| State | `success`, `warning`, `danger`, `info` plus muted fills | Errors, connection health, task state; never colour alone |
| Presence | `presenceActive`, `presenceIdle`, `presenceOffline` | Familiar and live-session state with label/icon fallback |

The theme layer owns contrast-safe fallbacks while palette data is unavailable.
Views consume these roles only; task priority and familiar presence do not carry
their own local hex values. This keeps theme refresh, dark mode, and accessible
contrast coherent.

Typography uses Dynamic Type styles (`.body`, `.callout`, `.subheadline`,
`.caption`, `.title3`, and `.headline`) with relative scaling only where a
special display treatment is necessary. Fixed heights may preserve touch targets
but must never clip larger type; row content may grow vertically.

## Surface treatments

### App shell and navigation

- Make the drawer’s current destination, active chat, and unread/active states
  distinct through semantic selection fill, title weight, and an icon/label —
  not an accent wash alone.
- Consolidate header controls into a compact, consistently sized glass control
  group with 44 pt minimum targets and visible focus treatment.
- Use responsive layout rules: iPhone prioritises a contextual title and one
  leading navigation affordance; iPad retains a persistent context rail where
  space permits.

### Chats and composer

- Preserve the existing readable message column, streaming behaviour, haptics,
  and session controls.
- Clarify message grouping with calmer author/time metadata, semantic tool/run
  states, and a stronger distinction between assistant work, user intent, and
  system notices.
- Make composer readiness visible in words and icon state; keep send, stop, and
  attachment actions reachable, labelled for VoiceOver, and visually ordered by
  their availability.
- Use restrained glass only around the composer and floating navigation chrome;
  messages remain on opaque or near-opaque content surfaces.

### Tasks

- Replace visually flat task rows with a compact hierarchy: task title,
  meaningful status/assignee/context metadata, and a separate, accessible state
  treatment.
- Give list, board, and task detail a shared status/priority vocabulary. The
  primary task mutation is explicit; destructive or secondary actions move to a
  contextual menu.
- Keep grouping and filtering discoverable without making the screen a control
  panel. Empty, loading, offline, and failure states use the same hierarchy.

### Search, New Chat, and Familiars

- Search begins with a focused, labelled field and presents results in grouped,
  scannable native rows. Recent and no-result states explain the next action.
- New Chat becomes a short intent-first flow: choose or confirm the familiar,
  then the model/context only when useful. Advanced setup remains available but
  does not compete with starting a conversation.
- Familiar cards and detail surfaces use the semantic presence roles, scalable
  names/descriptions, and one obvious next action. Decorative avatars never
  duplicate essential state.

### Settings and connection health

- Preserve familiar iOS settings grouping while applying the same spacing,
  section-header, disclosure, and semantic state system as the rest of the app.
- Connection/auth health is a concise status card with an explanatory label and
  a single recovery action. It must distinguish unavailable service, expired
  authentication, and local configuration without asking the user to decode a
  colour.

## Accessibility and motion

- Respect Dynamic Type through all app chrome and all high-traffic rows;
  validate the largest accessibility sizes on a phone and iPad.
- Maintain 44 pt touch targets, VoiceOver labels/hints for icon-only controls,
  semantic headings, and sensible rotor order.
- Every state tint pairs with text and/or an icon. Verify standard, increased
  contrast, and reduced-transparency appearances.
- Motion remains purposeful: selection and state transitions use existing
  short motion; `Reduce Motion` removes nonessential transforms while preserving
  state feedback.

## Compatibility and non-goals

- Keep the iOS 18.0 deployment target. Newer system glass APIs may be used only
  behind availability checks with the existing material/`Glass` presentation as
  an equivalent fallback.
- Preserve current API, websocket, auth, task, chat, model, and familiar data
  contracts. This programme is presentation and interaction hierarchy work.
- Do not redesign desktop, change the server theme payload, replace working
  navigation architecture, or remove useful information solely for minimalism.
- The separate standalone-trace fix for `apps/ios/**/build-*` remains in
  `cave-g9vir`; this design does not absorb that release-build defect.

## Delivery slices and proof

Implementation should proceed in reviewable slices, each independently usable:

1. **Foundation:** semantic theme roles, scalable type helpers, shared native
   screen/row/control primitives, and source-contract tests.
2. **Shell and chat:** drawer/header/composer hierarchy and chat state clarity.
3. **Work surfaces:** Tasks, Search, New Chat, and Familiars convergence.
4. **Settings and hardening:** connection/auth states, accessibility polish, and
   regression cleanup.

Each slice receives focused Swift/source-contract coverage and a native
simulator build. The final proof set includes iPhone and iPad screenshots in
light/dark mode, large Dynamic Type, Reduce Transparency, and Reduce Motion;
VoiceOver traversal of the main navigation, chat composer, task mutation, and
connection recovery; plus the existing iOS test suite and an Xcode simulator
build/test from the generated project.

## Acceptance criteria

- High-traffic iOS screens share semantic colour, spacing, type, selection, and
  action hierarchy without raw local styling drift.
- Chat remains fast and readable; the composer and streaming states are
  unambiguous and accessible.
- Tasks, Search, New Chat, Familiars, Settings, and connection recovery have
  coherent native hierarchy rather than a mix of bespoke glass and legacy dense
  forms.
- The app is usable at accessibility Dynamic Type sizes and with reduced
  transparency, increased contrast, and reduced motion enabled.
- iOS 18 support, existing data contracts, and the latest successful iOS
  release path remain intact.
