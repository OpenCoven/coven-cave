# Familiar Chatout — Codex-Style Overhaul (Phase 1)

**Branch:** `feat/familiar-chatout-codex`
**Worktree:** `coven-cave.wt/familiar-chatout-codex`
**Reference:** `docs/familiar-chatout-codex/codex-reference.jpg` (screenshot of OpenAI Codex desktop chat)
**Status:** Phase 1 — visual scaffolding behind a feature flag, no data wiring yet.

---

## Why

Val asked us to closely emulate the OpenAI Codex desktop chat pattern in Coven Cave's familiar chat surface. People love and trust that flow because it makes agent work **legible**: each step is a small status note, file edits are surfaced as cards, and the right inspector shows environment, subagents, and sources at a glance.

Today, Cave's familiar conversation is bubble-style chat (`chat-view.tsx`, `message-bubble.tsx`, `inspector-pane.tsx`, `chat-surface.tsx` etc., ~6500 lines combined). We want to add a **parallel** Codex-style transcript surface behind a feature flag so we can iterate on it without breaking anyone using the current view.

Phase 1 is **visual only** — stub data, no real diff/git wiring. Phase 2 will wire data sources.

## Phase 1 deliverable

A working `cave.chatout.codex` feature-flag-gated route or panel where you can preview the new familiar chat layout end-to-end with realistic stub data. Story / preview entry point so Val can click into it without flipping the global flag.

## Layout spec

### Three-column workspace

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  Top bar (chat title, subtle utility icons)                                         │
├──────────────┬───────────────────────────────────────────────┬─────────────────────┤
│              │                                               │                     │
│  Left        │           Main transcript canvas              │   Right inspector   │
│  sidebar     │           (status-log style)                  │                     │
│  ~13% width  │           ~66% width                          │   ~21% width        │
│  ~260 px     │                                               │   ~390 px           │
│              │                                               │                     │
│              │                                               │                     │
│              ├───────────────────────────────────────────────┤                     │
│              │   Bottom composer (Ask for follow-up changes) │                     │
└──────────────┴───────────────────────────────────────────────┴─────────────────────┘
```

For Phase 1 we focus on the **center transcript canvas + right inspector + bottom composer**. The left sidebar (recent chats, plugins, automations, repos) is a follow-up; Cave already has nav surfaces we'll integrate with later.

### Color palette (dark-only for Phase 1)

| Token                     | Hex          | Usage                                       |
|---------------------------|--------------|---------------------------------------------|
| `--cv-bg`                 | `#0B0B0C`    | App background                              |
| `--cv-bg-elevated`        | `#111214`    | Sidebars, secondary surfaces                |
| `--cv-card`               | `#16171A`    | Card / message-card surface                 |
| `--cv-card-hover`         | `#1A1B1E`    | Card hover                                  |
| `--cv-inspector`          | `#17181B`    | Right inspector panel                       |
| `--cv-border`             | `#2A2B2F`    | Card borders                                |
| `--cv-divider`            | `#232428`    | Subtle section dividers                     |
| `--cv-input-border`       | `#313236`    | Input borders, focus state slightly bumped  |
| `--cv-text`               | `#EDEDED`    | Primary text                                |
| `--cv-text-2`             | `#A9A9AA`    | Secondary text                              |
| `--cv-text-3`             | `#7B7C80`    | Muted / metadata                            |
| `--cv-text-disabled`      | `#5D5E62`    | Placeholder, disabled                       |
| `--cv-add`                | `#74D07A`    | Diff additions (+N)                         |
| `--cv-del`                | `#E06A6A`    | Diff deletions (-N)                         |
| `--cv-accent`             | `#A78BFA`    | Familiar accent (purple/lavender)           |
| `--cv-accent-2`           | `#8AA7D8`    | Inline link / secondary accent              |
| `--cv-pill-bg`            | `#222326`    | Pill / secondary button fill                |
| `--cv-row-selected`       | `#242528`    | Selected sidebar row                        |
| `--cv-send`               | `#3FB6B0`    | Send button (teal-ish circle)               |

We'll declare these as CSS custom properties on a `.cv-codex` root scope so we don't pollute Cave's global theme.

### Typography

- **Sans:** `Inter, ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", sans-serif`
- **Mono:** `ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- Sizes: top title `16–18px / 500`, sidebar items `14–16px / 400-500`, body chat `14–15px / 400`, file-card filename `13–14px / 500`, metadata/muted `12–13px / 400`, run-time chip `12px / 500`.
- Line height: chat body `1.55`, code/mono `1.5`.

## Components to build (Phase 1)

All under `src/components/familiar-chatout-codex/` so they're cleanly isolated.

### `<FamiliarChatTranscript>` — center canvas

- Status-log style (not bubble chat).
- Vertically stacked turns. Each turn is one or more **rows**:
  - **User row** — right-aligned dim card or simple inline text right-justified, max-width ~720px, slightly lighter surface.
  - **Assistant prose row** — left-aligned, normal text on app background, no card; light secondary text for "thinking" / italic transitions, primary text for actual prose.
  - **Centered pill row** — for short directives like "commit and publish after we confirm…". Small `--cv-card`-tinted pill, italic muted text, centered horizontally.
  - **File-edit card row** — see below.
  - **Aggregate edit card row** — see below.
  - **Inline mono pill** — for paths/branches/packages inline in prose: `<code class="cv-mono-pill">`.
- Footer micro-row under each assistant turn:
  - `↻ retry` pill (ghost button).
  - Tiny copy / regen icons on hover.
  - Optional `Worked for 35m 15s` chip when run had a duration.

### `<TranscriptCard>` — file-edit card

- Header bar with three regions:
  - Left: filename or aggregate label (e.g. `src/components/foo.tsx`, `Edited 9 files +121 -107`).
  - Right: action buttons — `Open in` (split menu), `Undo`, `Review`. Ghost pill style, mono-spaced where appropriate.
- Body: scrollable list of file rows when aggregate; each row shows:
  - File path (mono).
  - `+N` (green) and `-N` (red) chips on the right.
- "Show N more files" disclosure when collapsed.
- Footer: small "Reviewed" or run-status chip on the right when applicable.
- All inside a `--cv-card` surface with `--cv-border` hairline border, ~10px radius.

### `<EnvironmentInspector>` — right inspector top section

- Section header `Environment`, muted `--cv-text-3`, `13px / 500`.
- Items (each row ~36px tall, hairline divider between):
  - **Changes** with a small numeric pill on the right.
  - **Local** with branch name in mono-pill (e.g. `main`).
  - **Commit** indicator (small dot + label).
- Compact spacing, no boxes per row — just rows on the inspector surface.

### `<SubagentsList>` — right inspector middle section

- Section header `Subagents`.
- Each row: small avatar (24×24, rounded-square) on the left + name + tiny status dot.
- For Phase 1 use our familiar glyphs from Cave assets (Cody, Kitty, Sage, Echo, Astra, Charm, Nova). Glyph images live somewhere like `src/assets/familiars/` — find and reuse, don't recreate. If size doesn't fit, render at 24×24 with `image-rendering: pixelated` to keep the 8-bit vibe.

### `<SourcesList>` — right inspector bottom section

- Section header `Sources`.
- Empty state: `No sources yet` muted `--cv-text-3`, italic.
- Stubbed list shape for when sources exist (each row: source-icon + title + relative time). Keep stub minimal.

### `<FollowUpComposer>` — bottom composer

- Pill-rounded input on `--cv-card` surface, full width within the main canvas, ~56px tall, ~12px gutter from canvas edge.
- Placeholder: `Ask for follow-up changes`.
- Inside the pill (left to right):
  - `+` attach button (ghost icon).
  - `Custom` preset pill button.
  - `5.5 High` model picker dropdown.
  - microphone icon.
  - circular send button — solid `--cv-send` background, ~36px diameter, centered arrow icon.

### `<RunTimeChip>` — small reusable chip

- `Worked for 35m 15s` — pill with a tiny stopwatch icon. Mono numbers.

### `<RetryRow>` — assistant turn footer

- `↻ retry` ghost pill + copy/regen icons that fade in on hover.

## Stub data

Build a `mockTranscript.ts` that simulates a realistic Codex session: user asks for a refactor, agent narrates 6–10 steps, edits 3 files (one card per file), one aggregate edit card with 9 changes, one centered pill ("commit and publish after we confirm…"), one retry row, run-time chip "Worked for 12m 04s".

Build a `mockInspector.ts` with stub environment (Changes: 9, Local: branch `feat/familiar-chatout-codex`, Commit: `Push pending`), stub subagents list (Cody, Kitty, Sage, Echo, Astra), and empty `Sources`.

## Feature flag

- Add `cave.chatout.codex` flag (boolean, default `false`).
- New route `/preview/codex-chatout` (or whatever Cave's preview route convention is) that always renders the new view regardless of flag — for design review.
- When flag is on, swap the existing familiar chat view for the new one; otherwise leave unchanged.
- Document the flag in the PR description.

## Cave-specific paths (verified)

- **Mockup/preview routes already live at:** `src/app/mockup/` (Cave's design-preview convention).
  - Add the new mockup at `src/app/mockup/familiar-chatout-codex/page.tsx`.
- **Components dir:** `src/components/` is flat with ~270 files. Put new components under a folder so they don't pollute that flat list:
  - `src/components/familiar-chatout-codex/FamiliarChatTranscript.tsx`
  - `src/components/familiar-chatout-codex/TranscriptCard.tsx`
  - `src/components/familiar-chatout-codex/EnvironmentInspector.tsx`
  - `src/components/familiar-chatout-codex/SubagentsList.tsx`
  - `src/components/familiar-chatout-codex/SourcesList.tsx`
  - `src/components/familiar-chatout-codex/FollowUpComposer.tsx`
  - `src/components/familiar-chatout-codex/RunTimeChip.tsx`
  - `src/components/familiar-chatout-codex/RetryRow.tsx`
  - `src/components/familiar-chatout-codex/CenteredPill.tsx`
  - `src/components/familiar-chatout-codex/UserRow.tsx`
  - `src/components/familiar-chatout-codex/AssistantProseRow.tsx`
  - `src/components/familiar-chatout-codex/index.ts` (barrel)
  - `src/components/familiar-chatout-codex/styles.module.css` or scoped CSS-in-JS (match Cave's existing pattern — peek at `chat-router.tsx` etc. for conventions).
  - `src/components/familiar-chatout-codex/mockTranscript.ts` (stub data)
  - `src/components/familiar-chatout-codex/mockInspector.ts` (stub data)
- **Feature flag**: There's no existing `feature-flag` lib; pick the lightest pattern in Cave (likely a simple `process.env.NEXT_PUBLIC_CAVE_CHATOUT_CODEX` check or a settings entry). Inspect `src/lib/` and `src/app/settings/` to find Cave's preferred pattern. If none, add a tiny `src/lib/feature-flags.ts` with a `caveChatoutCodex()` getter.
- **Familiar avatars**: Cave already has a familiar-avatar component — `grep -rln "FamiliarAvatar\|familiar-glyph\|familiar-avatar" src/` to find it and reuse. Don't recreate assets.
- **Test convention**: Cave colocates tests as `*.test.ts(x)` next to source. Add at minimum:
  - `src/components/familiar-chatout-codex/FamiliarChatTranscript.test.tsx` (renders without errors).
  - `src/components/familiar-chatout-codex/TranscriptCard.test.tsx` (renders aggregate + single-file shapes).
- **Verification commands** (run before commit):
  - `pnpm typecheck`
  - `pnpm test:app` for focused unit tests of new components.
  - Pre-commit gitleaks hook (runs automatically).

## Non-goals for Phase 1

- Do **not** wire real git diff data, real run timing, real file watch.
- Do **not** rewire the existing `chat-view.tsx`.
- Do **not** ship to main at the global flag default-on. Default-off, preview route always-on for review.
- Do **not** redesign the left sidebar yet.

## Verification before commit

- `pnpm typecheck` (or Cave's equivalent) must pass.
- `pnpm lint` must pass.
- Component smoke: each new component renders without errors at the preview route.
- Visual screenshot of the preview route attached to the PR.
- Pre-commit gitleaks hook passes.

## Constraints / hard rules

- **Never** push to `main` without Val's explicit `Enchant merge to main` phrase. PR only, even at the end.
- Use `cv-claim` if available; otherwise set `COVEN_AGENT_ID=cody` in env so the Coven parallel-work protocol can detect this lane.
- Stay on this branch (`feat/familiar-chatout-codex`) and only modify files under:
  - `src/components/familiar-chatout-codex/**`
  - `src/styles/familiar-chatout-codex/**` (if needed)
  - `src/preview/**` for preview route
  - `src/lib/feature-flags.ts` (or wherever flags live) — minimal addition only
  - `docs/familiar-chatout-codex/**`
  - `package.json` only if a new dep is genuinely needed (and ask first via comment).
- **Do NOT** modify the existing `chat-view.tsx`, `message-bubble.tsx`, `inspector-pane.tsx`, `chat-surface.tsx` in this PR.

## Acceptance

Phase 1 PR is acceptable when:

1. Preview route renders the new transcript + inspector + composer with stub data.
2. Visual closely matches the reference image (`codex-reference.jpg`) for the center + right + bottom composer.
3. Feature flag plumbed but defaults off.
4. Verification gate passes.
5. PR opened to `coven-cave` against `main` with screenshot, branch is `feat/familiar-chatout-codex`.
