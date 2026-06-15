# Coven Cave whole-page streamline — design spec

**Date:** 2026-06-09
**Status:** approved-design, pending implementation plan
**Scope:** Whole-page UI/UX refactor of the Chat surface and the global frame around it (sidebar + top bar). Full redesign intensity.

---

## Goal

The current Chat page surfaces three competing status signals in one strip (a green `● ready` pill, a mono `openclaw · openclaw-local` meta string, and a high-contrast `💬 hi COMPLETED` pill), repeats **familiar identity** across the global top bar (`CovenCave › Home › Nova`, where `Nova` is the active familiar's display name) and the sidebar (`FamiliarSwitcher` already shows `Nova`), and duplicates the harness/model meta on every assistant turn and inside the composer dock. The header strip is ~110px tall in steady state.

Streamline by:

1. Removing redundant chrome (breadcrumb, duplicate familiar identity, duplicate model meta, decorative turn numbers, "You" labels).
2. Folding ephemeral state (streaming, failed, offline) into the meta line itself rather than emitting a separate pill.
3. Adopting a quiet, command-first global frame: centered `⌘K` search bar, right-cluster for notifications + account, sidebar carries primary nav + familiar identity (via the existing `FamiliarSwitcher`).

---

## Direction (locked in via brainstorm)

- **Layout direction:** C — Command-first (Raycast-ish). Centered command bar replaces the breadcrumb + search. Status disappears when "ready."
- **Global frame variant:** B — Bar + right cluster. Command bar stays slim and search-only. Bell + avatar pull to far right. Sidebar keeps its existing `FamiliarSwitcher` at top.
- **Chat header treatment:** Hybrid of A (two-row structure) + B (compactness, meta-line-IS-the-status banner).
- **Thread + composer:** Delete decorative chrome; meta drops from 5 pieces to 3 per turn.

---

## Surface 1 — Global top bar (`src/components/top-bar.tsx`)

**Today:** `CovenCave` brand (line 42) · `Home` button (line 43–45) · breadcrumb `› {surfaceLabel} › {subContext}` (lines 46–57) · search button (lines 59–68) · NotificationBell + gear-six settings button (lines 70–88).

**On chat mode:** `surfaceLabel = active.display_name` (the familiar name — "Nova"), and `subContext` is undefined. On non-chat modes (e.g. Library): `surfaceLabel` is "Home" or similar, `subContext` is the active familiar's name. Verified at `workspace.tsx:848` and `:853`.

**Proposed:**

- Drop the `CovenCave` brand mark from this row.
- Drop the `Home` button — duplicate of sidebar `Home` item.
- Drop the breadcrumb (`{surfaceLabel}` / `{subContext}`) entirely. Sidebar's `FamiliarSwitcher` carries the familiar; sidebar's active `FolderRow` carries the section.
- Centered command bar: keep the existing search button look (`⌘ Jump to anything… ⌘K`) but center it in the row (max-width ~560px). On click, opens the existing command palette unchanged.
- Right cluster: NotificationBell + a small circular avatar that opens the settings/account menu (replaces the standalone gear-six button). Avatar uses a neutral account glyph — **not** the familiar color, since the familiar isn't an account.
- Row height drops from current (~48px) to ~40px.

**Files:** `src/components/top-bar.tsx` (rewrite layout; remove `surfaceLabel`/`subContext` props). Update call sites in `src/components/workspace.tsx` at lines 848, 853, 1062, 1063 (delete the computations entirely — nothing else references them per grep).

---

## Surface 2 — Sidebar (`src/components/sidebar-minimal.tsx`)

**Today:** `FamiliarSwitcher` row (familiar avatar + name + caret) with an inline `+` New Chat icon button next to it, then a `New Chat` ActionRow below (mobile-priority but currently rendered desktop too). Then sections `Work` (Home, Chat, Board, Calendar, Inbox), `Knowledge` (Library), `Tools` (Browser, Terminal, Roles, Capabilities, GitHub when gated). Bottom: Settings button. `kbd` hints `⌘1–8` are defined in `FOLDER_MODES` (lines 67–90) and rendered by `FolderRow` (lines 138–168).

**Proposed:**

- **Keep** the `FamiliarSwitcher` at sidebar top — canonical familiar anchor under variant B. Its existing presence dot (`sidebar-familiar-switcher__presence` via `computePresence`) already conveys harness/daemon state for the active familiar; **do not** add a separate daemon indicator that would double-report it.
- Surface keyboard hints (`⌘1`, `⌘2`, …) more visibly. The hints are wired and rendered as `<kbd className="sidebar-folder-kbd">`; current CSS makes them muted to the point of invisibility (verified from the screenshot — they're not readable). Bump the kbd contrast a step.
- **Sections (Work / Knowledge / Tools) already exist** — no grouping work needed. The screenshot just cuts off above Tools.
- Drop the duplicate `New Chat` ActionRow (lines 413–419) on desktop — the `+` icon next to `FamiliarSwitcher` does the same thing. Keep the ActionRow for mobile via existing responsive CSS, or move it under a `sm:` breakpoint.

**Files:** `src/components/sidebar-minimal.tsx` (CSS-side: kbd contrast; structure-side: scope the desktop New Chat ActionRow off). No new state plumbing — daemon/presence already wired through `computePresence`.

---

## Surface 3 — Chat surface header (`src/components/chat-surface.tsx` + `src/components/chat-view.tsx`)

**Today:** Two-row header. Row 1 from `chat-surface.tsx` (Chats/Memory tabs + `+ New`). Row 2 from `chat-view.tsx` (`● ready` pill + `openclaw · openclaw-local` meta + `💬 hi COMPLETED` pill via `ChatContextStrip`). Then a separate `ChatLifecycleStatus` bar above the composer when busy.

**Proposed three rows, two are conditional:**

- **Row 1 (always):** Tabs (`Chats`, `Memory`) left; `+ New chat` right (quiet text button — already this). Height 34px. Rendered in `chat-surface.tsx` — unchanged.
- **Row 2 (only when `ChatView` is mounted with an active session):** Inline-editable title left; meta string right. Meta is `<harness> · <model> · <duration>` in steady state. Height 32px. When `ChatRouter` is on the list view (`ChatList`, no active session), Row 2 is **not rendered** — the list owns its own header.
  - **Streaming:** Pulsing yellow dot prepended; meta becomes `<model> · writing… · esc to cancel`; line color shifts to warm.
  - **Failed:** Red dot prepended; meta becomes `<model> · failed · retry?`; line color shifts to danger. The existing retry chip stays but only renders the chip itself — the meta line carries the error word.
  - **Offline (this familiar's daemon down):** Red dot prepended; meta becomes `daemon offline · check Coven`.
- **Row 3 (conditional):** Linked context chips — task + GitHub items — only when `ChatLinkedContext` has entries. Same chip style as today but quieter.

**Removed:**

- The green `● ready` pill — redundant with the existing `FamiliarSwitcher` presence dot driven by `computePresence`. Just delete; do not relocate.
- The high-contrast `💬 hi COMPLETED` chat-title pill (title is now its own typographic element on row 2; completion is implicit when meta is gray).
- `ChatLifecycleStatus` bar above the composer (folded into row 2's meta line).

Header height goes from ~110px steady to ~66px.

**Files:** `src/components/chat-view.tsx` (replace `ChatContextStrip` and `ChatLifecycleStatus` rendering with a new row-2 component that takes `{busy, lifecycle, error, durationMs, harness, model}` and a separate row-3 component for linked context). `src/components/chat-surface.tsx` is essentially unchanged.

---

## Surface 4 — Thread (per-turn rendering, `src/components/chat-view.tsx::TurnRow`)

**Today (assistant turn):** index (`01`) · avatar · name · streaming/lifecycle status chip · timestamp · duration · tool count.

**Today (user turn):** `You · 8:48 PM` label · right-aligned bubble.

**Proposed:**

- **Assistant turn meta drops to 3 pieces:** name · timestamp · status-chip-when-not-complete. Duration moves into the header meta line (since one chat = one duration). Tool count collapses into the existing `Tool activity` disclosure summary; the disclosure chip is the count chip.
- **User turn:** drop the `You` label entirely — right-aligned bubble + bubble color say it. Keep timestamp as a small line under the bubble.
- **Turn numbers (`01`, `02`):** delete. They're decorative and never referenced.

**Files:** `src/components/chat-view.tsx::TurnRow` and the small `cave-linear-turn-index` CSS rule.

---

## Surface 5 — Composer dock (`src/components/chat-view.tsx::ChatView` footer)

**Today:** attach button · model-only pill (`◆ {familiar.model}` — just the model, not harness, lines 1259–1262) · send button. The header row 2 carries `harness · model · project` — overlapping but not identical strings.

**Proposed:**

- Drop the composer model pill. The header meta line is the canonical model display; the composer's job is composing, not status. Recover the visual room.
- Keep attach + send.
- Composer placeholder picks up `⌘↵ to send` hint — actually `Enter to send / Shift+Enter for newline`, verified at `chat-view.tsx:1021–1025`. So label it accordingly: placeholder reads `Message {name}…  ↵ to send`.

**Files:** `src/components/chat-view.tsx` (composer dock; placeholder string).

---

## Surface 6 — Debug log leak in transcript (server-side)

The screenshot shows an orange `[model-fallback/decision] model fallback decision: decision=candidate_succeeded …` line as the first thing in the assistant transcript. This is not chrome; it's content being emitted into the message stream. It does not belong in the user-facing transcript.

- Suppress these decision logs from the SSE stream that feeds the chat, or strip them in `chat-view.tsx::splitReasoning` (extend the same `<thinking>`/`<reasoning>` peeling logic with a new bracketed-debug-prefix filter).
- This is the only surface in this spec that may touch a route handler. Likely candidate: `src/app/api/chat/send/` or whichever component constructs the SSE frames.

---

## File inventory

| File | Change |
|---|---|
| `src/components/top-bar.tsx` | Remove brand mark (line 42), home button (43–45), breadcrumb (46–57). Center search button. Account avatar replaces gear-six (80–88). Height down. |
| `src/components/sidebar-minimal.tsx` | Bump `sidebar-folder-kbd` contrast so `⌘1–8` hints are readable. Scope desktop `New Chat` ActionRow off (lines 413–419). No new state plumbing. |
| `src/components/chat-view.tsx` | Replace `ChatContextStrip` + `ChatLifecycleStatus` with new compact row 2 (rendered only when active session). Conditional row 3 for linked context. Drop turn index, drop "You" label on user turns, drop composer model pill. Update composer placeholder. |
| `src/components/chat-surface.tsx` | Essentially unchanged. Tabs row is already close. |
| `src/components/workspace.tsx` | Delete `surfaceLabel`/`subContext` computations at lines 848 / 853 and stop passing them at 1062 / 1063. |
| CSS (search for `cave-chat-linear-header-*`, `cave-linear-turn-index`, `cave-chat-lifecycle-status`, `top-bar__*`) | Trim removed selectors. Add `.cave-chat-meta-line` with `--writing` / `--failed` / `--offline` color modifiers. |
| `src/app/api/chat/send/*` or `chat-view.tsx::splitReasoning` | Filter `[model-fallback/*]` and similar bracketed decision logs out of assistant text. Origin TBD by implementation plan. |

---

## Out of scope

- Visual theme / palette changes. This is a structural streamline.
- Composer slash-command suggestions popover (works well, untouched).
- Memory tab (`AgentsMemoryView`) layout — only the tab itself changes (drop status pill).
- Right-panel inspector (`RightPanel` in `chat-surface.tsx`) — keep current behavior.
- Touch the global command palette (`⌘K`) UI — search button just opens the existing palette.
- Mobile layout — keep current mobile shell unchanged for this pass.

---

## Success criteria

- Chat surface header is one row (tabs) when on the `ChatList` view, and two rows (tabs + meta) in an active session in steady state; never three.
- `● ready` daemon pill no longer appears in the chat header (presence dot on the `FamiliarSwitcher` avatar remains the only indicator).
- `hi COMPLETED` (or any `<title> <STATUS>` chip) no longer appears in the chat header for completed chats.
- `CovenCave › Home › Nova` breadcrumb no longer appears in the global top bar — on any mode, not just chat.
- "You" label and turn numbers no longer appear in the transcript.
- Composer dock has no model pill.
- `[model-fallback/decision]` text no longer appears as assistant content.
- Existing tests still pass; new behavior covered by additions to `chat-view-polish.test.ts`, `chat-header-row.test.ts`, and a new top-bar test.

---

## Open questions for implementation plan

- Where exactly does the `[model-fallback/decision]` line originate (`/api/chat/send` route vs the harness adapter vs the model itself echoing logs)? Implementation plan should locate it before writing the filter, since "filter in `splitReasoning`" is a fallback only if the source can't be fixed.
- Are there callers of TopBar outside `workspace.tsx` that depend on `surfaceLabel`/`subContext`? Grep showed only `workspace.tsx` references, but settings sub-pages or future surfaces may want a contextual hint. Confirm before deleting the props (vs leaving them but unused).
- Is there a non-chat surface that genuinely benefits from a contextual hint at the top (e.g. Library showing collection name)? If so, "drop the breadcrumb" needs an alternate per-surface affordance; if not, the deletion is total.
