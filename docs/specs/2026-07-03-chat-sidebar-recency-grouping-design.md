# Chat sidebar: "Organize sidebar" menu with a recency view

Date: 2026-07-03
Status: approved (user-approved in session; see PR for implementation)

## Problem

The chat-mode left sidebar (`src/components/chat-sidebar.tsx`, added in #2265)
groups threads exclusively into collapsible project folders. Users who think in
"what was I just talking about?" rather than "which project was that in?" have
no recency-ordered view. Reference UX (user-supplied screenshot): an
**Organize sidebar** submenu in the sidebar's overflow menu with checkmarked
mode options.

## Decisions (user-confirmed)

1. **Both views stay; a menu switches them.** No segmented toggle — a `⋯`
   options button in the sidebar header opens a popover menu with an
   "Organize sidebar" group: **By project** and **Recent chats**.
   Two options only: the screenshot's third mode ("Recent projects") is what
   the existing By-project view already does (groups ordered by latest
   activity), so it would be a redundant entry.
2. **Default is Recent chats.** The choice persists per browser in
   localStorage; there is no daemon/server involvement.
3. **Recent view shape: time buckets** — Today / Yesterday / Previous 7 days /
   Previous 30 days / Older — rendered as plain label headers (not
   collapsible folders), the ChatGPT/Claude.ai pattern.
4. **Drop the "ago" suffix** on sidebar row times: `2m`, `3h`, `1d`, then a
   short date (`Jun 12`). Scoped to the sidebar via a new density in
   `relative-time.ts`; other surfaces keep "2h ago".

## Design

### Data: `src/lib/chat-recency.ts` (new, pure)

```ts
export type ChatRecencyBucketKey = "today" | "yesterday" | "week" | "month" | "older";
export type ChatRecencyBucket = {
  key: ChatRecencyBucketKey;
  label: string;            // "Today", "Yesterday", "Previous 7 days", …
  sessions: SessionRow[];   // recency-sorted, newest first
};
export function deriveChatRecencyBuckets(sessions: SessionRow[], nowMs: number): ChatRecencyBucket[];
```

- Bucket boundaries use **local calendar days** computed from the injected
  `nowMs` (repo convention — same clock-injection as `home-digest.ts`):
  Today = same local date; Yesterday = previous local date; Previous 7 days =
  2–7 calendar days old; Previous 30 days = 8–30 calendar days old; Older =
  more than 30 calendar days old.
- Timestamp per session = `updated_at || created_at` (same fallback as
  `chat-projects.ts`). Unparseable timestamps land in Older.
- Empty buckets are omitted. Input is defensively re-sorted newest-first.

### View preference: `src/lib/chat-session-prefs.ts`

```ts
export const CHAT_SIDEBAR_VIEW_KEY = "cave:chat:sidebar-view";
export type ChatSidebarView = "recent" | "projects";
export function readChatSidebarView(): ChatSidebarView; // SSR-safe, default "recent"
```

Read after mount (same hydration idiom as pins in the same file); written on
change. Corrupt/unknown values fall back to `"recent"`.

### Time format: `src/lib/relative-time.ts`

Add a `"bare"` density: identical thresholds to `"compact"` but no `" ago"`
suffix ("just now" stays; future times keep `in 5m`). `chat-sidebar.tsx`'s
`compactTime` switches to it. `isRelativePhrase` is unaffected (no caller
feeds it bare output; noted in a comment).

### Component: `src/components/chat-sidebar.tsx`

- **Header options button**: `⋯` (`ph:dots-three` family) button in the header
  row, `aria-label="Sidebar options"`, opening a popover menu (reuse the
  existing popover/menu primitive; match the GitHub action popover's focus
  trap + Escape + arrow-key behavior, #2288). Menu content: a non-interactive
  "Organize sidebar" group label, then two `role="menuitemradio"` items —
  "By project", "Recent chats" — with `aria-checked` + a check icon on the
  active one. Selecting closes the menu, applies immediately, persists.
- **ThreadRow extraction**: the ~90-line per-thread row JSX (status dot,
  title, time, hover pin/delete, delete-confirm strip) is extracted into a
  local `ThreadRow` component in the same file, used verbatim by both views —
  the row markup/classes do not change.
- **Recent view render branch**: buckets from `deriveChatRecencyBuckets`
  render as `<section>`s with the same uppercase label style as the existing
  "Pinned" header, each followed by its rows. Rows are flush-left (no folder
  indent). `THREADS_PREVIEW` (6) + "Show N more" applies **per bucket**
  (state keyed by bucket key, mirroring the per-group `showAllByKey` set).
- **Unchanged in both views**: Pinned section on top; search box semantics
  (in Recent view the query filters rows, empty buckets drop out, and — as
  with project groups today — search shows all matches, ignoring
  Show-more truncation); New chat / back button / footer; per-project
  register + New-chat-in-project affordances remain in the By-project view
  only. The header's static "Projects" caption becomes the active view's
  name ("Recent chats" / "Projects").
- **Hydration**: first client paint renders the default (Recent); the stored
  pref applies in the post-mount effect alongside pins. A brief flash for
  By-project users is accepted (same trade-off the pins hydration makes).

### Not changing

- No daemon/API/schema changes; nothing about how sessions are fetched.
- No changes to `deriveChatProjectGroups` or the By-project rendering path
  beyond the ThreadRow extraction.
- CodeSidebar (code mode) is out of scope.

## Testing

- `src/lib/chat-recency.test.ts` (new): bucket boundaries around midnight,
  7/30-day edges, empty-bucket omission, invalid-timestamp → Older,
  fallback to `created_at`, fixed injected clock. Wire into `run-tests.mjs`
  SUITES (and ALIAS_LOADER if it imports via `@/`).
- `src/lib/relative-time.test.ts`: bare-density cases.
- `src/components/chat-sidebar-wiring.test.ts`: update source-text pins —
  menu present, both `menuitemradio` items, recency import, bare time
  density, ThreadRow used by both branches.
- e2e `chat-sidebar-nav.spec`: adapt for the new default (Recent buckets) and
  add a menu round-trip (switch to By project, expect folder headers).

## Risks / notes

- `chat-sidebar-wiring.test.ts` and the e2e spec pin today's markup; both are
  updated in the same PR (Frontend build runs the source-text suites; E2E is
  a required check).
- Multi-session repo: surface checked at design time — no open PR or live
  claim touches `chat-sidebar.tsx`.
