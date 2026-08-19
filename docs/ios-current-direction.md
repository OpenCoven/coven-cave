# Native iOS Current Direction

Status: **canonical active direction**

Last reconciled: 2026-08-19

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
4. [`design-handoff/IMPLEMENTATION-STATUS.md`](design-handoff/IMPLEMENTATION-STATUS.md)
   — evidence of what actually landed and what was deliberately not adopted.

When these disagree with an older iOS note or plan, the order above wins.

## Current product shape

- Chats is familiars-first: one familiar row leads to its conversations.
- The drawer is the sole primary navigation surface. Its primary destinations
  are Chats, Tasks, and Settings; Projects and Familiars remain first-class
  drawer actions.
- The native iOS Terminal, PTY transport, xterm WebView, terminal composer,
  slash-command route, generated bundle, and tests are retired. Desktop and web
  terminal surfaces are unaffected.
- Chats uses an editorial serif title, a visible conversation count, one
  contextual Projects action, and a floating search/New Chat dock.
- Settings presents Community as one icon row and Connection status plus
  re-check as one row.
- The open drawer preserves spatial context by presenting the live destination
  as a rounded, offset page.
- Theme values come from `ChromePalette`; Dynamic Type, VoiceOver, Reduce
  Motion, Reduce Transparency, and 44pt targets remain release requirements.

## Current priorities

1. Preserve reliability, pairing, honest failure states, draft durability, and
   existing task/chat/project contracts.
2. Finish visual cohesion across the three primary destinations without
   restoring a bottom tab bar or recents-first Chats home.
3. Improve information density only when it adds real operator context; do not
   invent activity, status, progress, or backend capabilities.
4. Keep source contracts and native simulator coverage aligned with every
   intentional behavior change.

## Next visual improvements

The 2026-08-19 iPhone 16 Pro simulator pass identified these next candidates:

1. **Refine familiar-row rhythm.** Protect the preview from clipping at large
   accessibility sizes and tighten the relationship between name, timestamp,
   presence, preview, and divider.
2. **Unify primary-surface headers.** Bring Tasks and Settings closer to the
   Chats editorial hierarchy while keeping each surface's real controls and
   native navigation behavior.
3. **Make the floating Chats dock adaptive.** Reduce its footprint in landscape
   and regular-width split views while preserving keyboard and safe-area
   behavior.
4. **Clarify the title count.** Keep the compact badge, but make its visual and
   accessibility meaning unmistakably "conversations" rather than an unlabeled
   status number.
5. **Use low-density space deliberately.** When only one familiar is present,
   offer truthful, context-aware next actions without reintroducing a global
   recent-thread feed.

These are candidates, not permission to bypass a Bead, design review, or the
protected pull-request path.

## Historical-document policy

- Files under `docs/**/plans/`, dated specs, audits, and handoff exports are
  records of decisions and implementation lineage.
- Completed checklists stay completed; do not resume unchecked boxes from an
  old plan merely because they remain in the file.
- A historical document becomes active again only when this page names it under
  Current priorities and a current Bead defines the remaining work.
- Contradictory terminal, bottom-tab, unified-recents, or tokenless-auth plans
  are explicitly superseded.
