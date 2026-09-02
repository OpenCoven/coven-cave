# Native iOS Current Direction

Status: **canonical active direction**

Last reconciled: 2026-08-27

This page is the only iOS priority queue. Dated specifications, implementation
plans, audits, handoff exports, and rebuild notes remain useful historical
evidence, but they do not authorize new work unless this page links them under
Current authorities or Current priorities.

## Current authorities

1. [`coven-design-language.md`](coven-design-language.md) — tokens,
   accessibility, motion, copy, and interaction quality.
2. This document — current native iOS product shape and priority order.
3. [`superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md`](superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md)
   — the supporting Chats information-architecture rationale.
4. [`superpowers/specs/2026-08-26-ios-chatgpt-performance-design.md`](superpowers/specs/2026-08-26-ios-chatgpt-performance-design.md)
   — the approved instant-resume, durable-outbox, and native-rendering
   architecture for chat.
5. [`design-handoff/IMPLEMENTATION-STATUS.md`](design-handoff/IMPLEMENTATION-STATUS.md)
   — evidence of what actually landed and what was deliberately not adopted.

When these disagree with an older iOS note or plan, the order above wins.

## Current product shape

- Chats is familiars-first: one familiar row leads to its conversations.
- When App Lock permits disclosure, launch resumes the last active local
  conversation without waiting for remote bootstrap. Opening Chats from the
  drawer still returns to the familiars-first home.
- The drawer is the sole primary navigation surface. Its primary destinations
  are Chats and Tasks; Projects and Familiars are grouped as contextual
  workspace resources, while the profile avatar is the sole drawer entry to
  Settings.
- The native iOS Terminal, PTY transport, xterm WebView, terminal composer,
  slash-command route, generated bundle, and tests are retired. Desktop and web
  terminal surfaces are unaffected.
- Chats, Tasks, and Settings share one editorial title language while retaining
  the controls and navigation behavior specific to each destination.
- Chats names its visible conversation count, protects familiar previews at
  accessibility sizes, offers truthful shortcuts when the list is sparse, and
  uses a floating search/New Chat dock that compacts in landscape and caps its
  width on iPad.
- Settings presents Community as one icon row and Connection status plus
  re-check as one row. Legal links share the same concise icon-shelf pattern.
- The open drawer preserves spatial context by presenting the live destination
  as a rounded, offset page.
- Theme values come from `ChromePalette`; Dynamic Type, VoiceOver, Reduce
  Motion, Reduce Transparency, and 44pt targets remain release requirements.

## Current priorities

1. Preserve reliability, pairing, honest failure states, draft durability, and
   existing task/chat/project contracts.
2. Implement the approved instant native chat architecture: durable offline
   outbox, incremental native response blocks, viewport-bounded transcript
   work, and physical-device performance evidence.
3. Finish visual cohesion across the three primary destinations without
   restoring a bottom tab bar or recents-first Chats home.
4. Improve information density only when it adds real operator context; do not
   invent activity, status, progress, or backend capabilities.
5. Keep source contracts and native simulator coverage aligned with every
   intentional behavior change.

## Next visual improvements

The five candidates from the 2026-08-19 simulator pass are implemented. No
additional visual queue is active; further work must begin with fresh simulator
evidence and a current Bead rather than resuming an older plan.

## Historical-document policy

- Files under `docs/**/plans/`, dated specs, audits, and handoff exports are
  records of decisions and implementation lineage.
- Completed checklists stay completed; do not resume unchecked boxes from an
  old plan merely because they remain in the file.
- A historical document becomes active again only when this page names it under
  Current priorities and a current Bead defines the remaining work.
- Contradictory terminal, bottom-tab, unified-recents, or tokenless-auth plans
  are explicitly superseded.
