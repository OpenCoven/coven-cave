# Native iOS Current Direction

Status: **canonical active direction**

Last reconciled: 2026-09-04

This page is the only iOS priority queue. Dated specifications, implementation
plans, audits, handoff exports, and rebuild notes remain useful historical
evidence, but they do not authorize new work unless this page links them under
Current authorities or Current priorities.

## Current authorities

1. [`coven-design-language.md`](coven-design-language.md) - tokens,
   accessibility, motion, copy, and interaction quality.
2. This document - current native iOS product shape and priority order.
3. [`specs/2026-09-04-ios-project-workspaces-direction.md`](specs/2026-09-04-ios-project-workspaces-direction.md)
   - global Recent Chats, visible Project workspaces, local scope, object-owned
   navigation, migration, and authority boundaries.
4. [`specs/ios-new-chat-project-contract.md`](specs/ios-new-chat-project-contract.md)
   - project-bound creation, persistence, retry, forwarding, voice, import, and
   offline replay invariants. Its clauses requiring shell-project switching
   before New Chat, global Familiar routing, thread opens, or task opens are
   superseded by authority #3; #5297 must amend those clauses while preserving
   explicit binding and fail-closed eligibility.
5. [`design-handoff/IMPLEMENTATION-STATUS.md`](design-handoff/IMPLEMENTATION-STATUS.md)
   - evidence of what actually landed and what was deliberately not adopted.

When these disagree with an older iOS note or plan, the order above wins.

The dated
[`superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md`](superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md)
remains implementation lineage for the current app. Its one-familiar-row Chats
default is superseded by the project-workspaces direction. Pin, mute, archive,
rename, duplicate, export, bulk delete, unread, session selection, exact
Familiar identity, and one-visible-conversation behavior remain requirements
until intentionally migrated by the active program.

## Current product direction

- Chats opens to global Recent conversations. A conversation is the resumable
  object; Familiar and Project identity stay visible on each row.
- Projects are visible, directly navigable workspaces. A Project page groups
  truthful existing chats, tasks, Familiars, and verified attention items
  without becoming a new authority or database.
- Chats, Tasks, Search, Familiars, and Needs You own explicit local scope.
  Opening an object does not silently rescope unrelated surfaces.
- A project explicitly confirmed after migration may become a visible default
  for new work where it is current and unambiguous. The old persisted project
  value is a display hint only because its operator/automatic provenance was
  not stored. Neither value defines shell identity.
- Cached history may remain readable while membership or authority data is
  loading, stale, degraded, disconnected, or unavailable. New sends and
  protected mutations remain fail-closed until exact current binding and grant
  data is known.
- Unassigned is an explicit recovery-only collection, never a normal writable
  project or new-work default.
- Familiars remain first-class identity and operational hubs. Familiar
  continuity, revision, embodiment, provenance, and authoritative IDs must not
  be reconstructed from display name, prompt, avatar, or model.
- The drawer remains the sole primary navigation surface. Its active program
  adds a bounded Projects section and one All Projects destination; it does not
  restore a bottom tab bar.
- The native iOS Terminal, PTY transport, xterm WebView, terminal composer,
  slash-command route, generated bundle, and tests remain retired. Desktop and
  web terminal surfaces are unaffected.
- Chats, Tasks, and Settings retain one editorial title language while keeping
  the controls and navigation behavior specific to each destination.
- Chats continues to protect conversation context at accessibility sizes and
  uses a floating Search/New Chat dock that compacts in landscape and caps its
  width on iPad; the active program changes the row organization, not those
  quality requirements.
- Chats names the visible conversation count for its current organization and
  scope, and offers only truthful shortcuts when the list is sparse.
- Settings continues to present Community as one icon row and Connection status
  plus re-check as one row. Legal links keep the same concise icon-shelf
  pattern.
- The open drawer preserves spatial context by presenting the live destination
  as a rounded, offset page.
- Theme values come from `ChromePalette`; Dynamic Type, VoiceOver, Reduce
  Motion, Reduce Transparency, focus return, and 44-point targets remain release
  requirements.

## Active program

OpenCoven/coven-cave#5290 replaces ambient project mode with Project workspaces
and global feeds. Its phase gates are authoritative:

1. **Direction and baseline**
   - #5291 ratifies information architecture and authority boundaries.
   - #5292 captures pre-change Release physical-device evidence and budgets.
2. **Fast state foundation**
   - #5293 builds the immutable, disposable Cave read projection and removes
     project-keyed destination remounts.
   - #5294 migrates current rows/counts to the projection and makes Search
     cancellable.
3. **Global Chats and Project workspaces**
   - #5295 makes global Recent Chats the default.
   - #5296 adds the bounded drawer Projects section, All Projects, and project
     workspace pages.
   - #5297 replaces ambient scope with surface-local filters and exact
     object-owned navigation while preserving fail-closed writes.
4. **OpenCoven integration and closeout**
   - #5298 integrates cross-project Familiar and verifiable Needs You views.
   - #5299 closes physical-device, accessibility, migration, rollback, and R4
     authority gates.

Later phases remain blocked until their listed dependencies have merged and
their Beads/worktrees satisfy the repository lifecycle.

## Current priorities

1. Complete #5291 and #5292 without beginning implementation behind either
   phase gate.
2. Preserve reliability, pairing, honest failure states, draft durability,
   queued-target immutability, and existing task/chat/project contracts.
3. Build one projection and one canonical project browser; do not create
   per-view caches or parallel workspace implementations.
4. Remove hidden global-rescope side effects only in the R4 integration phase,
   with upgrade, deep-link, offline replay, and real authorization evidence.
5. Improve information density only with truthful operator context; do not
   invent attention, activity, status, progress, membership, or backend
   capability.
6. Keep source contracts and native simulator/device coverage aligned with
   every intentional behavior change.

## Non-goals

- No desktop/web redesign in this program.
- No new project, chat, session, task, Familiar, or attention authority.
- No chat project-binding move.
- No project creation, deletion, re-rooting, access administration, or Git
  management UI.
- No inferred urgency or model-generated Needs You eligibility.
- No simulator timing represented as physical-device percentile evidence.
- No release or TestFlight publication authorization.

## Historical-document policy

- Files under `docs/**/plans/`, dated specs, audits, and handoff exports are
  records of decisions and implementation lineage.
- Completed checklists stay completed; do not resume unchecked boxes from an
  old plan merely because they remain in the file.
- A historical document becomes active again only when this page names it under
  Current priorities and a current Bead defines the remaining work.
- Contradictory terminal, bottom-tab, ambient-project, familiars-first default,
  unified-recents-without-project-binding, or tokenless-auth plans are
  explicitly superseded.
