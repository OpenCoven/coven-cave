# Native iOS Current Direction

Status: **canonical active direction**

Last reconciled: 2026-09-12

This page is the only iOS priority queue. Dated specifications, implementation
plans, audits, handoff exports, and rebuild notes remain useful historical
evidence, but they do not authorize new work unless this page links them under
Current authorities or Current priorities.

## Current authorities

1. [`coven-design-language.md`](coven-design-language.md) - tokens,
   accessibility, motion, copy, and interaction quality.
2. This document - current native iOS product shape and priority order.
3. [`specs/ios-new-chat-project-contract.md`](specs/ios-new-chat-project-contract.md)
   - project-bound creation, persistence, retry, forwarding, voice, import, and
   offline replay invariants. Project choice belongs to a conversation, not
   the application shell.
4. [`design-handoff/IMPLEMENTATION-STATUS.md`](design-handoff/IMPLEMENTATION-STATUS.md)
   - evidence of what actually landed and what was deliberately not adopted.

When these disagree with an older iOS note or plan, the order above wins.

The dated
[`superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md`](superpowers/specs/2026-08-03-ios-chat-familiars-first-design.md)
remains implementation lineage for the current app. Its one-familiar-row Chats
default is superseded by the chat-only direction. Pin, mute, archive,
rename, duplicate, export, bulk delete, unread, session selection, exact
Familiar identity, and one-visible-conversation behavior remain requirements
until intentionally migrated by the active program.

## Current product direction

- Native iOS is **chat-only**: conversations, chat search, familiar selection
  within chat, permissions, and configuration that enables or customizes chat.
- Chats opens to global conversations, including direct and group chats and
  sessions started on other devices. Hydrated sessions appear once, not once
  as a local thread and again as a server row. Pins, archive visibility, and
  title/familiar search organize the list without a global project filter.
- The drawer contains Chats, recent conversations, New chat, Search chats, and
  Settings. There is no Tasks, Automations, Projects, Needs You, standalone
  Familiar hub, workspace browser, global search, or terminal destination.
- Familiar identity remains authoritative and visible in conversations and
  participant selection; it is not an invitation to an operational hub.
- A registered project is an exact conversation-level execution/access
  binding. New chat can select eligible access locally; it never changes the
  application's scope. Opening existing history preserves that chat's root,
  session identity, participants, draft, and queued targets.
- Cached history may remain readable while membership or authority data is
  loading, stale, degraded, disconnected, or unavailable. New sends and
  protected mutations remain fail-closed until exact current binding and grant
  data is known.
- Unassigned remains a recovery-only classification inside history, never a
  writable project, new-chat default, or separate workspace destination.
- Familiar continuity, revision, embodiment, provenance, and authoritative IDs
  must not be reconstructed from display name, prompt, avatar, or model.
- Settings round trips and access-catalog refreshes do not remount Chats or
  destroy its selection. iPhone launches to the list unless an explicit chat
  intent is present; iPad keeps its list/detail layout.
- The native iOS Terminal, PTY transport, xterm WebView, terminal composer,
  slash-command route, generated bundle, and tests remain retired. Desktop and
  web terminal surfaces are unaffected.
- Chats and Settings retain one editorial title language while keeping
  the controls and navigation behavior specific to each destination.
- Chats continues to protect conversation context at accessibility sizes and
  uses a floating Search/New Chat dock that compacts in landscape and caps its
  width on iPad; the active program changes the row organization, not those
  quality requirements.
- Chats names the visible conversation count for its current organization and
  scope, and offers only truthful shortcuts when the list is sparse.
- Settings contains appearance, permissions, connection, security, chat
  notifications/export, and legal information. Promotional/community browsing
  is outside the mobile chat surface.
- The open drawer preserves spatial context by presenting the live destination
  as a rounded, offset page.
- Theme values come from `ChromePalette`; Dynamic Type, VoiceOver, Reduce
  Motion, Reduce Transparency, focus return, and 44-point targets remain release
  requirements.

## Active program

`cave-iusli` owns this chat-only implementation. The maintainer explicitly
approved replacing the workspace roadmap, recorded on
[#5290](https://github.com/OpenCoven/coven-cave/issues/5290#issuecomment-5644986219).
This supersedes the product expansion in #5290, including project workspaces,
Tasks, Needs You, and operational Familiar hubs. `cave-quv9h`'s native
Automations destination conflicts with this boundary and must not be added.

The dated project-workspaces specification remains historical evidence, not a
second active roadmap. Its useful requirements for exact object ownership,
cached reads, fail-closed writes, migration, accessibility, and physical-device
performance remain applicable. Superseding that roadmap does not constitute
passing its device baselines, authorization exercises, or release gates.

## Current priorities

1. Complete the chat-only shell and conversation list on `cave-iusli`, retiring
   non-chat navigation and external entrypoints rather than hiding them.
2. Preserve reliability, pairing, honest failure states, draft durability,
   queued-target immutability, and exact chat/project authorization contracts.
3. Use one disposable list projection for local/server deduplication, counts,
   sorting, and chat search; do not scan full transcripts to organize every row.
4. Keep New chat/import choice local and revalidate participants and access
   before creation. Reject retired task links without loading task surfaces.
5. Improve information density only with truthful operator context; do not
   invent attention, activity, status, progress, membership, or backend
   capability.
6. Keep source contracts and native simulator/device coverage aligned with
   every intentional behavior change.

## Non-goals

- No desktop/web redesign in this program.
- No new project, chat, session, task, Familiar, or attention authority.
- No chat project-binding move.
- No project browser, project creation/deletion/re-rooting, or Git management UI.
  Permissions needed for chat remain available.
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
- Contradictory workspace expansion, terminal, bottom-tab, ambient-project,
  familiars-first default, unified-recents-without-project-binding, or tokenless-auth plans are
  explicitly superseded.
