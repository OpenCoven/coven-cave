# Faster Chat Discovery, Concise Titles, and Reflected-Thread Archiving

**Bead:** `cave-e59cz`
**Status:** Approved for implementation
**Scope:** Chat session discovery, generated chat titles, and reflection-driven archiving

## Problem

Three related lifecycle behaviors make Chat feel less immediate and less tidy:

1. A newly created conversation can take roughly 30 seconds to appear in the
   sidebar. The workspace already polls `/api/sessions/list` every four seconds,
   but the first session refresh can race ahead of conversation persistence.
   When that happens, no later lifecycle event explicitly refreshes the list, so
   input-focused polling pauses or a slow backend can extend the visible delay.
2. Generated and auto-renamed titles can still read like clipped prompts rather
   than compact labels.
3. A thread reflection represents a wrapped-up thread, but reflection-driven
   archiving is currently disabled by default.

## Goals

- Show a newly persisted conversation in the Chat sidebar without waiting for
  periodic polling.
- Keep generated titles short, plain, and easy to scan.
- Archive reflected thread chats by default.
- Preserve manual titles, per-chat keep overrides, and the existing safeguards
  for automatic reflections.

## Non-goals

- Replacing the session-list polling loop or introducing a new realtime
  transport.
- Adding model-backed title generation.
- Changing manual rename limits.
- Archiving periodic, mid-flight self-reports.
- Changing the reflection interface or sidebar layout.

## Design

### 1. Refresh the session list after persistence settles

The existing `ChatView -> ChatRouter -> Workspace` callback chain remains the
single refresh mechanism:

- `ChatView` receives the stable session ID from the stream.
- `ChatRouter` promotes a new compose view to that session ID.
- `Workspace.loadSessions` fetches the authoritative list and applies project
  scoping, local deletion filtering, and GitHub context.

The first session event can arrive before the server has saved enough state for
`/api/sessions/list` to return the row. Therefore, session promotion alone is
not the persistence boundary. On the successful `done` event, after the server
has completed the send path, `ChatView` will explicitly invoke
`onSessionsChanged` for a newly created session. Existing sessions do not need
this creation refresh.

This is authoritative refresh rather than an optimistic synthetic row. The
sidebar continues to receive complete `SessionRow` data from the existing API,
so project filters, generated-session suppression, archive state, familiar
identity, and title overrides cannot diverge.

The four-second poll remains as recovery for external session creation and
transient refresh failures. This change removes the poll from the normal
new-chat critical path rather than increasing its frequency.

### 2. Use one concise generated-title contract

All automatic title paths continue through `chatSummaryTitle`:

- first-exchange naming;
- periodic auto-rename from the latest settled exchange;
- the title-row sparkle action.

The shared contract will produce a simple topic label:

- target **3-7 words**;
- hard maximum **40 characters**;
- no sentence-ending punctuation;
- no markdown or edge emoji;
- remove conversational request framing and common answer-heading boilerplate;
- clamp only at a word boundary and use an ellipsis only when truncation is
  unavoidable.

Short prompts still retain their meaningful wording after filler removal.
Long prompts prefer a concise assistant heading when one exists; otherwise the
cleaned user topic is shortened deterministically. The implementation stays
offline and synchronous.

Manual titles remain governed by the existing broader normalization limit.
Periodic auto-rename continues to preserve human-authored titles when
`preserveManualTitles` is enabled. The cadence setting is unchanged.

### 3. Archive reflected threads by default

`DEFAULT_CHAT_AUTO_ARCHIVE_POLICY.archiveOnReflection` changes to `true`.
Normalization continues to honor an explicitly stored `false`, so users can
disable the behavior in Chat Settings.

The existing reflection safeguards remain:

- manual reflections archive immediately because they are an explicit wrap-up;
- automatic reflections archive only after the existing idle threshold;
- periodic reflections never archive;
- keep-marked chats never auto-archive;
- already archived or missing sessions remain no-ops;
- archive failures do not fail reflection persistence.

When the reflection route reports `archivedAt`, `ChatView` continues to refresh
the session list immediately so the row leaves the active sidebar without
waiting for polling.

## Data Flow

### New chat

1. The user sends the first message from a compose view.
2. The server creates and persists the conversation while streaming the reply.
3. `ChatView` receives the stable session ID and promotes the router state.
4. The successful `done` event confirms the persistence path has settled.
5. `ChatView` calls `onSessionsChanged`.
6. `Workspace.loadSessions` fetches and renders the authoritative row.

### Generated title

1. A first exchange, periodic rename, or sparkle action supplies the freshest
   settled user/assistant exchange.
2. `chatSummaryTitle` removes framing and extracts a topic.
3. The shared concise-title clamp applies word and character limits.
4. The existing title persistence path stores the result.

### Reflection

1. A manual or automatic reflection is persisted by the self-report route.
2. `shouldAutoArchiveOnReflection` applies policy, trigger, idle, keep, and
   archive-state gates.
3. The route archives eligible sessions and returns `archivedAt`.
4. The active Chat view refreshes the session list.

## Error Handling

- A failed session-list refresh leaves the current list intact; the existing poll
  retries.
- A failed or errored first reply does not trigger the successful completion
  refresh.
- Empty or unusable title inputs return `null`, preserving the current title.
- Reflection archiving remains best-effort and cannot turn a successful
  reflection into an error response.

## Testing

Add or update focused tests for:

- a new chat refreshing the session list on successful completion after its
  session ID is known;
- no duplicate creation refresh for ordinary follow-up sends;
- generated titles staying within 40 characters and seven words;
- filler, punctuation, markdown, emoji, and long-heading cleanup;
- first-exchange, periodic auto-rename, and sparkle paths continuing to share the
  same title helper;
- reflection archiving defaulting on while explicit `false` remains respected;
- manual, automatic, periodic, keep-marked, missing, and already archived
  reflection cases retaining their current gates.

Run the targeted app tests for the touched chat lifecycle modules, followed by
the repository typecheck.

## Acceptance Criteria

- A newly persisted chat appears in the sidebar from the completion-triggered
  refresh, without relying on the next polling tick.
- Automatic titles are no longer than 40 characters or seven words and remain
  understandable topic labels.
- Human-authored titles are never shortened by the automatic-title contract.
- New/default configurations archive eligible reflected threads.
- An explicitly disabled reflection-archive setting remains disabled.
- Keep-marked chats, periodic reflections, and non-idle automatic reflections
  remain unarchived.
