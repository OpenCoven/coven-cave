# Chat UX Audit — Coven Cave vs. Claude Code / Cursor / ChatGPT (June 2026)

Audited at commit `af3fa0e` (2026-06-11). Benchmarks: **Claude Code (CLI + desktop)**, **Cursor/Windsurf**, **Claude.ai/ChatGPT**. Scope: desktop-first; mobile linear mode noted but ungraded. Method: code-level audit of the chat surfaces plus live Playwright inspection (16 scenarios against a mocked, paced SSE harness — see Method).

## 1. Summary & scoreboard

The chat experience has an unusually strong **status/lifecycle spine** (explicit test-pinned state machine, real SIGTERM interrupt, graceful error recovery) and **theming/a11y foundations** (9 themes × light/dark, reduced-motion kill switch, focus-trap infrastructure) — better than most benchmarks in places. It is held back by three silent P0 bugs, a missing **message-operations axis** (no edit / regenerate / branch), **markdown that only renders after the stream completes** (measured CLS 0.53 at completion), and a **change-review story that is paint, not workflow** (the agent mutates the working tree with zero in-app review or undo).

| # | Dimension | Grade | Verdict |
|---|---|---|---|
| D1 | Composer & context attachment | 2/5 | Polished pills/limits; but images silently never reach the model, and no paste, drag-drop, or `@`-mentions |
| D2 | Slash commands & discoverability | 2.5/5 | Real catalog with aliases/hints; menu footer promises Enter/Esc behaviors that don't exist; unknown commands silently swallowed |
| D3 | Streaming & perceived latency | 2/5 | Good pre-token indicator + cursor; raw markdown shown for the whole stream, full-bubble reflow at completion |
| D4 | Tool-call & reasoning transparency | 3/5 | Rich structured data (status, durations, debug pane); rendered as a trailing appendix, not Claude Code's chronological narrative |
| D5 | Interrupt, steer & queue | 2.5/5 | Interrupt is excellent (Esc + Stop morph + real SIGTERM); Enter mid-stream destroys the typed message |
| D6 | Message ops (copy/edit/regenerate) | 2/5 | Copy + expand modal exist; entire edit/regenerate/branch axis absent; actions are mouse-hover-only |
| D7 | Code presentation & apply actions | 3/5 | Benchmark-grade block chrome (Shiki, `lang:filename`, line numbers); dead copy buttons outside chat bodies; no file/apply actions |
| D8 | Diff & change review | 1/5 | Diff gutters render, but there is no accept/reject/revert/checkpoint anywhere |
| D9 | Session navigation & history | 3/5 | Strong list ergonomics and recovery states; zero URL addressability, title-only search |
| D10 | Scroll & reading ergonomics | 2/5 | FAB + timestamp grouping right; per-chunk smooth-scroll pinning fights the reader; no line-length cap in the shipped layout |
| D11 | Keyboard & focus model | 3/5 | Good chrome shortcuts and a correct shared focus trap; hover-only actions, trap-less overlays, incoherent Esc layering |
| D12 | Status, lifecycle & error comms | 4/5 | The strongest dimension; docked for signal redundancy, a desktop retry gap, and zero token/cost visibility |
| D13 | Visual hierarchy, theming & a11y | 4/5 | Exceptional theme/motion/text-scale foundations; light-mode breakage in code chrome, sub-AA micro-type, double live region |

**P0s (broken promises, silent failures):**
1. **CHAT-D2-01** — slash menu footer promises "↵ run · esc cancel"; Enter ignores the highlighted item and unknown/partial commands are *silently destroyed* (the "Unknown command" guard is dead code); Esc cannot dismiss the menu.
2. **CHAT-D1-01** — image attachments are previewed in the UI, then stripped before send; the model receives `"(content unavailable)"`.
3. **CHAT-D7-01** — code-block Copy buttons are rendered but never wired in tool blocks, the inspector, comux file preview, and the expand modal.

## 2. Method

- **Code audit:** four parallel read-only passes over `src/components/chat-view.tsx` (2,477 lines), `message-bubble.tsx`, `chat-surface.tsx`, `chat-list.tsx`, `chat-router.tsx`, `home-composer.tsx`, `shell.tsx`, `workspace.tsx`, `src/lib/slash-commands.ts`, `chat-attachments.ts`, `src/styles/cave-chat.css`, `src/app/globals.css`, and `src/app/api/chat/send/route.ts`. Intent-encoding tests (`chat-view-polish.test.ts`, `chat-view-lifecycle.test.ts`, `message-bubble-markdown.test.ts`, `message-bubble-code-header.test.ts`) were read so deliberately pinned behavior is labeled "deliberate, revisit" rather than flagged as accidental.
- **Live inspection:** a throwaway Playwright spec (never merged) ran 14 desktop + 2 mobile (Pixel 5) scenarios against `next dev` with all `/api/*` routes mocked and `/api/chat/send` served by an in-page fetch patch emitting the real SSE frame protocol with controlled pacing (30–120 ms/chunk) and honored AbortSignal. Quantitative observations (CLS, DOM counts, frame cadence, axe-core violations) appear in the Appendix.
- Severity: **P0** broken promise/bug in core flow · **P1** table-stakes benchmark feature absent, hit daily · **P2** ergonomic lag vs ≥1 benchmark · **P3** polish/consistency. Effort: S/M/L.

## 3. What already meets the bar

Credit where due — these are at or above benchmark convention and should not regress:

| Affordance | Evidence |
|---|---|
| Explicit turn lifecycle state machine (queued→connecting→streaming→tooling→complete/cancelled/failed), test-pinned | chat-view.tsx:47-54, 187-204; chat-view-lifecycle.test.ts |
| Esc-interrupt with partial-text retention + real `SIGTERM` to the harness child | chat-view.tsx:1369-1390, 1636-1639; route.ts:836-843 |
| Send→Stop button morph with tooltip naming the keyboard alternative | chat-view.tsx:2075-2096 |
| Failed-send retry banner replaying text *and* attachments | chat-view.tsx:1920-1938, 1406-1411 |
| ENOENT→onboarding routing; daemon-offline meta state; synthesized actionable diagnostics on empty responses | chat-view.tsx:1575, 618-619; route.ts:933-948 |
| Pre-token ThinkingIndicator with elapsed seconds; pulsing stream cursor ▌ | chat-view.tsx:2139-2169; message-bubble.tsx:502-504 |
| ProgressGroup auto-opens while pending, with live running/issue/done counts | chat-view.tsx:2274-2328 |
| Per-tool status chips, real hook-derived durations, auto-pretty-printed JSON I/O | chat-view.tsx:2355-2387; route.ts:768-787 |
| Streaming-safe reasoning extraction (handles unclosed `<thinking>` mid-stream) | chat-view.tsx:289-338 |
| Session debug pane: live event tail, copy/download debug bundle | debug-pane.tsx:184-389 |
| Code-block chrome: Shiki, `lang:filename` fences, line numbers >5 lines, diff gutters, Shiki-failure fallback | message-bubble.tsx:89-163 |
| Code-block copy button is always-in-DOM, CSS-hover revealed, `:focus-visible` reachable — the pattern D6-04 should copy | cave-chat.css:335-365 |
| Copy message copies raw markdown source, excludes `<thinking>` | message-bubble.tsx:524-533 |
| Expand-to-reading-view modal (no benchmark has this) | message-bubble.tsx:649-734 |
| Attachment pills with size + labeled remove; lightbox with truncation badge + dialog semantics; dual-end size/count limits | chat-view.tsx:2015-2037, 2389-2448; chat-attachments.ts:35-45 |
| Slash aliases, canonicalization, Tab-complete, arg placeholders, grouped `/help`, typo guard (when reachable — see D2-01) | slash-commands.ts; chat-view.tsx:1624-1628 |
| Inline rename with visible pencil; two-step inline delete on both surfaces | chat-view.tsx:469-593, 1761-1790; chat-list.tsx:89-92 |
| History load/missing/error notices with Retry + Back | chat-view.tsx:1804-1820 |
| Rich session rows (project, origin chip, dates, running emphasis) + persisted project scoping | chat-list.tsx:544-583, 129-149 |
| Timestamp gap logic (>10 min or role change) | chat-view.tsx:1862-1869 |
| Scroll FAB + scroll-position awareness | chat-view.tsx:1136-1145, 1905-1917 |
| ⌘B/⌘\/⌘J/⌃` pane toggles; ⌘K palette; platform-aware key glyphs | shell.tsx:303-351; workspace.tsx:458-470; platform-keys.ts |
| Shared Modal with full focus trap + restore (gap is adoption, not capability) | ui/modal.tsx:38; use-focus-trap.ts:48-67 |
| Composer is "home base": focus on session switch, after attach, after slash row click, after starter prompt | chat-view.tsx:1147-1149, 1462 |
| 9 themes × light/dark with no-flash boot; AA-retuned state colors; 110/125/150% text scale | globals.css:215-259, 2373-2686, 184-200 |
| Global `prefers-reduced-motion` kill switch + tokenized motion (live-verified) | globals.css:264-276 |
| `role="log"` transcript + `role="status"` MetaLine (semantics right; tuning issues in D12-04) | chat-view.tsx:1798-1802, 698 |
| Mobile: visual-viewport keyboard offset, action strip with proper disabled states, iOS no-zoom floor, `enterKeyHint="send"` | chat-view.tsx:971-981, 866-910; globals.css:320-324 |

## 4. Findings by dimension

### D1 · Composer & context attachment — 2/5

#### CHAT-D1-01 · Image attachments never reach the model · **P0**
- Evidence: `src/lib/chat-attachments.ts:50-52` — `stripPreviewOnlyAttachmentFields` drops `dataUrl`/`mimeType`; `:77-84` — `const body = attachment.text ? […] : "(content unavailable)"`. The UI accepts images (`fileToAttachment`, chat-view.tsx:268-277), previews them in the lightbox, then sends the harness literally "(content unavailable)".
- Benchmark: Claude Code / ChatGPT — attached images are actually delivered to the model.
- Recommendation: Deliver image data to the harness (temp-file path or base64 channel per adapter capability), or block image attach with an explicit "images not supported" notice. Silent preview-then-drop is the worst of both.
- Effort: M

#### CHAT-D1-02 · No paste-to-attach · P1
- Evidence: chat-view.tsx:2043-2046 — `onPaste` reads only `text/plain` (CSV sniff); `clipboardData.items`/files never inspected.
- Benchmark: Claude Code and ChatGPT — paste an image and it becomes an attachment.
- Recommendation: Iterate `e.clipboardData.items`, route `kind === "file"` through `fileToAttachment`. (Images blocked on D1-01 end-to-end.)
- Effort: S

#### CHAT-D1-03 · No drag-and-drop attach · P1
- Evidence: chat-view.tsx — no `onDrop`/`onDragOver` handlers exist (grep verified); only attach path is the hidden file input (:2056-2062).
- Benchmark: ChatGPT — drop overlay anywhere over the conversation; Cursor/Windsurf accept drops into the composer.
- Recommendation: Drop target on the chat section with a visible overlay, routed through the existing `attachFiles`.
- Effort: S

#### CHAT-D1-04 · No `@`-mention / repo-file context picker · P1
- Evidence: chat-view.tsx:2038-2053 — no mention trigger; project context is only the free-text CWD field (:388-400) + `projectRoot` prop.
- Benchmark: Cursor/Windsurf `@file`/`@folder` fuzzy picker with pills; Claude Code `@path` completion. For an agentic dev app that already knows `projectRoot` and ships a Projects browser, this is the defining composer feature of the category.
- Recommendation: `@` trigger reusing the slash-menu popover pattern, backed by a project-file index endpoint; selected files become pills in the existing row (:2015-2037).
- Effort: L

#### CHAT-D1-05 · No draft persistence; draft bleeds across sessions · P2
- Evidence: chat-view.tsx:943 — `useState("")`, no storage; session-switch effect (:1644-1647) resets only `confirmDelete`/`cwdDraft`; ChatView deliberately not remounted per session (chat-router.tsx:302-305).
- Benchmark: ChatGPT/Claude.ai — per-conversation drafts survive navigation. Here a half-typed message follows you from chat A into chat B and dies on Back.
- Recommendation: Key drafts by sessionId (restore on switch, clear on send) — fixes loss and bleed together.
- Effort: S

#### CHAT-D1-06 · CSV sniff hijacks attach and drops co-selected files · P3
- Evidence: chat-view.tsx:1449-1455 — early `return` after CSV detection discards every other selected file; no path to attach a CSV as a plain attachment.
- Recommendation: Attach all files normally; offer CSV import as an additive banner on the attached file.
- Effort: S

#### CHAT-D1-07 · Cannot stage attachments while streaming · P3
- Evidence: chat-view.tsx:2068 — `disabled={busy || attachments.length >= 10}` on the paperclip.
- Benchmark: ChatGPT — staging for the next message is allowed during a response.
- Recommendation: Drop the `busy` condition; staging is local state.
- Effort: S

### D2 · Slash commands & discoverability — 2.5/5

#### CHAT-D2-01 · Slash menu promises "↵ run · esc cancel"; Enter ignores the selection, Esc does nothing, and unknown commands are silently destroyed · **P0**
- Evidence (three compounding bugs):
  1. chat-view.tsx:1977 footer reads `↑↓ navigate · ↵ run · Tab complete · esc cancel`, but the slash branch of `onComposerKey` (:1613-1630) handles only ArrowUp/ArrowDown/Tab. Enter falls through to `send()` (:1631-1634) with the **typed** text — the arrow-key highlight is never consulted.
  2. Escape (:1636-1639) only fires `cancelSend()` when busy — the menu cannot be dismissed by Esc (live-verified: menu still open after Esc).
  3. The typed token goes to `intentFromSlash`, whose workspace fallback `onSlashFromChat` (workspace.tsx:980-983) **returns `true` unconditionally**, so the "Unknown command" guard (chat-view.tsx:1273) is dead code. `onPaletteIntent`'s slash switch (workspace.tsx:748-810) has no default feedback — unknown/partial tokens are swallowed and the input destroyed. Live repro: `/he` + Enter → composer cleared, nothing happens (screenshots `10-slash-menu-open.png`, `10-after-enter.png`).
- Benchmark: Claude Code — Enter runs the highlighted item; Esc closes the menu; unknown commands get inline feedback. HomeComposer already implements Enter correctly (home-composer.tsx:162-173) and its footer is honest.
- Recommendation: Port HomeComposer's Enter branch into the chat composer's slash block; add an Esc branch that dismisses the menu before the busy-cancel check; make `onSlashFromChat` return whether the command was actually handled (or add a default branch surfacing "Unknown command") so the existing guard becomes reachable again.
- Effort: S

#### CHAT-D2-02 · Menu vanishes on first space — no arg-phase hints · P2 *(deliberate, revisit)*
- Evidence: chat-view.tsx:985-987 — menu closes once input contains a space (mirrored by design in home-composer.tsx:86-92).
- Benchmark: Claude Code — the matched command stays pinned with its arg hint (`/attach <session-id>`) while you type args.
- Recommendation: When the first token canonicalizes to a command with `argPlaceholder`, keep a single pinned hint row instead of closing.
- Effort: M

#### CHAT-D2-03 · Prefix-only matching, no fuzzy/substring · P2
- Evidence: slash-commands.ts:75-83 — `startsWith` on name/aliases only.
- Benchmark: Claude Code/Cursor — fuzzy or substring match. The catalog is 22 entries; no index needed.
- Effort: S

#### CHAT-D2-04 · Slash menu has no combobox/listbox ARIA · P2
- Evidence: chat-view.tsx:1947-1975 — plain `ul/li/button`, visual-only active class; textarea (:2038-2053) lacks `role="combobox"`, `aria-expanded`, `aria-activedescendant`. Live-verified: no `role="listbox"` in the DOM with the menu open. Same in home-composer.
- Recommendation: Standard combobox pattern so SRs announce the highlighted command.
- Effort: S

#### CHAT-D2-05 · Static catalog — custom/user commands not surfaced · P3 *(deliberate — TUI alignment)*
- Evidence: slash-commands.ts:18-53 hardcoded.
- Recommendation: Merge daemon/familiar-specific commands with a section divider when available.
- Effort: M

#### CHAT-D2-06 · Bare `/run` is a silent no-op that strands input · P3
- Evidence: chat-view.tsx:1226-1227 — `if (!args.trim()) return true;` with no usage hint (contrast the `/save` branch which prints usage at :1236).
- Recommendation: `appendSystem("Usage: /run <task…>")` and clear input.
- Effort: S

### D3 · Streaming & perceived latency — 2/5

#### CHAT-D3-01 · Markdown renders only after `done` — raw source during stream, full-bubble reflow at completion · P1 *(deliberate "don't block" choice, revisit)*
- Evidence: message-bubble.tsx:475-480 — `if (pending) { setHtml(null); return; }`; fallback (:498-507) renders plain `whitespace-pre-wrap` text, so users watch literal ` ``` ` fences and `**bold**` for the entire stream (screenshot `04-mid-stream.png`), then the whole bubble re-typesets at done (`04-done.png`). **Live-measured cumulative layout shift at completion: 0.53** (Core Web Vitals "poor" threshold is 0.25).
- Benchmark: ChatGPT/Claude.ai — progressive markdown rendering during the stream (headings/code highlight live), zero completion reflow.
- Recommendation: Re-run `mdToHtml` on a debounce/idle callback per chunk (renderCache makes settled prefixes cheap), falling back to plain text only inside the trailing unterminated block.
- Effort: M

#### CHAT-D3-02 · OpenClaw path buffers the entire response — fake streaming · P2
- Evidence: route.ts:376-378, 397/437 — stdout accumulated, single `assistant_chunk` pushed on process close.
- Benchmark: first token <1 s everywhere; here OpenClaw users stare at the indicator for the full generation.
- Recommendation: Parse stdout incrementally if the CLI supports it; otherwise set expectations in the progress label.
- Effort: M

#### CHAT-D3-03 · Unbounded module-global `renderCache` keyed by full message text · P3
- Evidence: message-bubble.tsx:282, :440 — never evicted; keys are entire message bodies including every expand-modal/table re-render variant.
- Recommendation: Simple LRU cap (~200 entries).
- Effort: S

#### CHAT-D3-04 · Per-chunk full-text regex + smooth-scroll chase · P3
- Evidence: chat-view.tsx:1483 — `(t.text + ev.text).replace(/\n{3,}/g, "\n\n")` re-scans the full text every chunk; :2212 `splitReasoning` re-parses per render; :1132-1134 smooth `scrollIntoView` per chunk (see D10-01).
- Recommendation: `behavior: "auto"` while pending; memoize normalization/splitReasoning per turn id + length.
- Effort: S

#### CHAT-D3-05 · Two ThinkingIndicator implementations; the chat-local one lacks a11y/label · P3
- Evidence: chat-view.tsx:2139-2169 (local, bare dots, no role) vs ui/thinking-indicator.tsx:22-41 (shared, `role="status"`, label) — unused by ChatView.
- Recommendation: Use the shared component.
- Effort: S

#### CHAT-D3-06 · Elapsed time disappears once text starts streaming · P3
- Evidence: chat-view.tsx:2235-2236 — timer shows only pre-first-token; MetaLine (:623-626) shows "writing…" with no clock until `durationMs` lands at done.
- Benchmark: Claude Code — elapsed (and tokens) visible for the whole turn including tool phases.
- Recommendation: Move the elapsed counter into the streaming MetaLine or turn chip.
- Effort: S

### D4 · Tool-call & reasoning transparency — 3/5

#### CHAT-D4-01 · Tools render as a trailing "Tool activity" appendix, not interleaved chronologically · P1
- Evidence: chat-view.tsx:2234-2251 — fixed body order: MessageBubble → ProgressGroup → ReasoningBlock → ToolGroup; tool_use upsert (:1501-1545) appends to a flat array with no position relative to text. Live evidence: screenshot `06-tools-done-collapsed.png` — prose first, then three stacked groups below it; tools that ran *before* the answer text appear *after* it, inverting causality.
- Benchmark: Claude Code — each call collapsed inline at its chronological position (`Read(foo.ts)` … prose … `Bash(pnpm test)`); Cursor interleaves tool cards with prose.
- Recommendation: Model the assistant turn as an ordered segment list (text | tool | reasoning) keyed by arrival order; keep the count rollup as an optional header.
- Effort: L

#### CHAT-D4-02 · Collapsed tool row shows only the tool name — no argument one-liner · P2
- Evidence: chat-view.tsx:2360 — summary is `{tool.name}` + status chip; input is two `<details>` levels deep.
- Benchmark: Claude Code — `Read(src/foo.ts)` / `Bash(pnpm test)` collapsed lines let you audit a run without expanding.
- Recommendation: Derive a one-line arg summary from `tool.input` (first path/command, truncated) for ToolBlock summaries and progress details.
- Effort: S

#### CHAT-D4-03 · Tool ids keyed by name — concurrent same-name calls merge into one block · P2
- Evidence: route.ts:681-688 — `toolIdFor(name)` reuses an open call's id, so a second `Bash` starting before the first's `post_tool_use` overwrites the first's I/O and corrupts durations.
- Recommendation: Key by name + per-name open-call queue (or hook sequence id).
- Effort: S

#### CHAT-D4-04 · stream-json `tool_use` content blocks are dropped — transparency depends entirely on hook lines · P2
- Evidence: route.ts:735-745 — envelope parser extracts only `text` blocks; tool_use/tool_result blocks discarded. A harness without pre/post_tool_use hooks shows a turn sitting in silent "Using tools" with zero tool blocks.
- Recommendation: Map envelope `tool_use`/`tool_result` blocks into `kind:"tool_use"` events, deduping against hook-derived events.
- Effort: M

#### CHAT-D4-05 · File paths in tool I/O are inert text · P3
- Evidence: chat-view.tsx:2373-2384 — I/O renders through SyntaxBlock with no linkification.
- Benchmark: Cursor — paths in tool cards are clickable.
- Recommendation: Wrap path-like tokens in clickable spans opening the project file viewer (projectRoot is known).
- Effort: M

#### CHAT-D4-06 · Reasoning rendered through backtick-only RichText, not markdown · P3
- Evidence: chat-view.tsx:2267-2269 + rich-text.tsx:8 — bullets/headings/bold in expanded thinking show as raw markdown.
- Recommendation: Route expanded ReasoningBlock through the exported `MarkdownBlock`.
- Effort: S

#### CHAT-D4-07 · Expanded tool output blocks are unbounded in height · P3
- Evidence: cave-chat.css:824-829, 408-413 — no max-height; a 3,000-line Read output buries the transcript. (Contrast: system bubble caps at 320px, :1527.)
- Benchmark: Claude Code — "+N lines (ctrl+o to expand)" truncation.
- Recommendation: `max-height` + overflow or "show more" clamp on tool SyntaxBlocks.
- Effort: S

### D5 · Interrupt, steer & queue — 2.5/5

#### CHAT-D5-01 · Enter while streaming destroys the typed message · P1
- Evidence: chat-view.tsx:1413-1420 — `send()` runs `setInput(""); setAttachments([])` *before* `sendRaw`, whose busy guard (:1280) then returns. **Live-confirmed data loss**: typed mid-stream message → composer cleared, send-call count stayed 1, text appears nowhere (observation `queue-drop`: `composerValue: ""`, `bodyHasSecond: false`).
- Benchmark: Claude Code — messages typed while streaming are queued and dispatched when the turn ends; Cursor queues follow-ups; ChatGPT at minimum disables send rather than swallowing input.
- Recommendation: Minimum: move the busy check into `send()` before clearing state. Real fix: a `queuedSends` list rendered as a pill above the composer, flushed in `sendRaw`'s `finally`.
- Effort: S (minimum) / M (queue)

#### CHAT-D5-02 · Cancelled turn is rewritten as a harness error on reload · P2
- Evidence: chat-view.tsx:1370-1390 marks the local turn cancelled with partial text; but the server abort path (route.ts:836-843) falls through to the empty-response diagnostic (:933-948), saving `is_error: true` + a fabricated error message to the transcript (:954-985). Reload shows an error bubble where the user saw "(cancelled)".
- Benchmark: ChatGPT — a stopped response persists identically across reloads (partial text + "stopped" marker).
- Recommendation: Detect `req.signal.aborted` after `runAttempt` and persist a cancelled marker/partial text instead of the diagnostic.
- Effort: S

*(Edit-and-resend / rewind is covered under D6-01.)*

### D6 · Message operations — 2/5

#### CHAT-D6-01 · No edit-and-resubmit for user messages · P1
- Evidence: chat-view.tsx:2188-2209 — user TurnRow renders bubble + attachments only; no edit handler exists in the file (the only editable text is the session title). Claude Code's double-Esc rewind equivalent is also absent.
- Benchmark: ChatGPT/Claude.ai — pencil-edit forks the conversation; Cursor — edit-and-resubmit re-runs from that point.
- Recommendation: Edit affordance on user turns that pre-fills the composer and truncates/forks from that turn on resend. Edit-and-resend (drop trailing turns) covers the daily "fix my typo" case without true forking.
- Effort: M

#### CHAT-D6-02 · No regenerate for assistant turns · P1
- Evidence: chat-view.tsx:1406-1411 — retry exists only for *failed* sends. Note `.cave-model-badge` CSS (cave-chat.css:1560-1593) is orphaned with no consumer — a model switcher was seemingly started and dropped.
- Benchmark: ChatGPT/Claude.ai — Regenerate (with model switch) on every completed assistant message.
- Recommendation: Per-assistant-turn regenerate that re-sends the preceding user prompt; model-switch-on-regenerate later.
- Effort: M

#### CHAT-D6-03 · No version navigation or branching · P2
- Evidence: chat-view.tsx:56-71 — flat `Turn` type, strictly linear render.
- Recommendation: Defer until D6-01/02 exist, but design the turn store now so edits/regens append siblings (`parentId` + active-leaf pointer) rather than destroy history.
- Effort: L

#### CHAT-D6-04 · Message actions are JS-hover-gated — not in the DOM for keyboard/AT users · P1
- Evidence: message-bubble.tsx:613, 632-637 — `{hovered && !pending && <CopyBubble/>}`; buttons don't exist until `onMouseEnter`. Live-verified: 50-Tab traversal of a loaded chat reaches code-block Copy buttons (always-in-DOM pattern, credited) but message Copy/Expand only after mouse hover.
- Benchmark: Claude.ai/ChatGPT — actions always in the DOM, revealed via CSS `:hover`/`:focus-within`, hence Tab-reachable.
- Recommendation: Render unconditionally and gate visibility with CSS (`opacity-0 group-hover:opacity-100 focus-within:opacity-100` — the `group` classes at :607/:625 already anticipate this; the code-block copy button at cave-chat.css:335-365 is the in-repo reference implementation). Keep the row always visible on the last assistant turn and on coarse pointers.
- Effort: S

#### CHAT-D6-05 · Copying an attachment-only message copies the placeholder string · P3
- Evidence: chat-view.tsx:2201 — `content={turn.text || "Attached files"}` — CopyBubble copies the literal "Attached files".
- Recommendation: Hide copy when text is empty, or copy attachment names.
- Effort: S

#### CHAT-D6-06 · Image attachments render as chips, not inline thumbnails · P3
- Evidence: chat-view.tsx:2450-2477 — images render as paperclip chips; visible only via lightbox click-through.
- Benchmark: ChatGPT/Claude.ai — inline thumbnails.
- Recommendation: Small `<img>` thumbnail for `image/*` chips.
- Effort: S

### D7 · Code presentation & apply actions — 3/5

#### CHAT-D7-01 · Copy buttons are dead (never wired) on every non-chat-body surface · **P0**
- Evidence: message-bubble.tsx:160 — `renderCodeBlock` always emits the Copy button, but `wireCopyButtons` (:448-465) is invoked only from `MarkdownContent` (:494-496). `SyntaxBlock` (:200-228) and `MarkdownBlock` (:235-262) inject the same HTML and never wire it. Affected: ToolBlock input/output (chat-view.tsx:2376, 2382), inspector pane (inspector-pane.tsx:511, 566), comux file preview (comux-view.tsx:536), and code blocks inside the expand modal (:728).
- Benchmark: any — a rendered Copy button that silently does nothing on click is below all of them.
- Recommendation: Add the wiring effect to SyntaxBlock/MarkdownBlock, or better, one delegated click listener on the container.
- Effort: S

#### CHAT-D7-02 · Code-block header is not sticky · P2
- Evidence: cave-chat.css:210-219 — no `position: sticky`; on long blocks the lang label and Copy button scroll away (and blocks have no max-height, see D7-03).
- Benchmark: ChatGPT — sticky header with lang + copy; Cursor — sticky header with Apply/copy/open.
- Effort: S

#### CHAT-D7-03 · No max-height/collapse for huge code blocks · P2
- Evidence: cave-chat.css:265-273 — `pre` scrolls horizontally only; no vertical bound (system bubble caps at 320px, :1527 — precedent exists).
- Benchmark: Claude.ai — long code goes to an artifact panel; Claude Code truncates with expand.
- Recommendation: max-height + "Show more" above ~40 lines, reusing ExpandBubble as the full view.
- Effort: M

#### CHAT-D7-04 · `data-code` duplicates the entire code text into a DOM attribute · P2
- Evidence: message-bubble.tsx:160 — every block's full source serialized twice (highlighted + HTML-escaped attribute); via SyntaxBlock this includes whole file previews and tool outputs.
- Recommendation: Drop `data-code`; read from the adjacent `code` element or a render-time `WeakMap`.
- Effort: S

#### CHAT-D7-05 · Filename label is inert — no open-in-project link · P2
- Evidence: message-bubble.tsx:157-159 — plain span, despite a file-preview surface existing (comux-view.tsx:498-540).
- Benchmark: Cursor/Windsurf — filename in the header opens the file.
- Recommendation: When `projectRoot` resolves the filename, render it as a button opening the existing file preview.
- Effort: M

#### CHAT-D7-06 · Shiki theme + code chrome hardcoded dark while the app ships light modes · P2
- Evidence: message-bubble.tsx:34, 114 — single `mood-c-dark` theme; cave-chat.css:198 — fixed dark `oklch` surface. See also D13-01 (foreground tokens break on these surfaces in light mode).
- Benchmark: ChatGPT/Claude.ai — highlighting follows app mode (or dark chrome is paired with fixed light-on-dark ink).
- Recommendation: Either dual-theme Shiki keyed off `data-mode`, or pin the chrome's foregrounds to fixed light values.
- Effort: M

#### CHAT-D7-07 · Decorative traffic-light dots occupy the header's action zone · P3 *(deliberate, test-pinned — revisit)*
- Evidence: message-bubble-code-header.test.ts:13-35 pins them; cave-chat.css:221-238.
- Recommendation: First real estate to reclaim when D7-02/D7-05 add functional actions; update the intent test alongside.
- Effort: S

#### CHAT-D7-08 · Tables have no horizontal-overflow handling · P3
- Evidence: cave-chat.css:141-148 — no scroll wrapper; `overflow-wrap: anywhere` (:14) mangles wide tables by breaking words.
- Benchmark: ChatGPT — horizontal scroll container.
- Recommendation: Wrap rendered tables in an `overflow-x: auto` div during table substitution (message-bubble.tsx:419-437).
- Effort: S

### D8 · Diff & change review — 1/5

#### CHAT-D8-01 · No accept/reject/revert/checkpoint workflow anywhere · P1 (strategic)
- Evidence: repo-wide grep for accept/reject/revert/checkpoint/undo over src/components + src/lib — only library undo-delete toasts and read-only eval-loop stats. ToolBlock output is read-only.
- Benchmark: Cursor/Windsurf — per-file accept/reject bar + review panel + checkpoint restore; Claude Code — permission gate before each Edit/Write. Severity tempered by Coven Cave being chat-first — but the agent mutates the user's working tree with zero in-app review or undo.
- Recommendation: Minimum viable: per-session "files changed" summary (git status against the session's `project_root`) with per-file revert. Full accept/reject gating is a later milestone. The skeleton exists: ProjectTree + per-file SyntaxBlock preview (comux-view.tsx:498-540) only lack the git-diff data source and actions.
- Effort: L

#### CHAT-D8-02 · Edit-tool calls show raw JSON, not a structured diff · P2
- Evidence: chat-view.tsx:2373-2384 — `SyntaxBlock` on `tool.input`; `autoDetectLang` (message-bubble.tsx:176-184) only triggers diff chrome on textual `diff --git` patterns — an Edit tool's `{old_string, new_string}` payload renders as a JSON blob.
- Benchmark: Claude Code — every Edit renders as a before/after diff block.
- Recommendation: Special-case file-mutation tool names in ToolBlock: parse old/new strings and render through the existing `cave-diff-*` classes.
- Effort: M

#### CHAT-D8-03 · Diff headers mislabeled as add/del lines · P3
- Evidence: message-bubble.tsx:137-144 — `+++ b/file` gets `cave-diff-add`, `--- a/file` gets `cave-diff-del`.
- Recommendation: Exclude `^\+\+\+ `/`^--- `; style `^@@` hunk headers as metadata.
- Effort: S

### D9 · Session navigation & history — 3/5

#### CHAT-D9-01 · No URL deep-links — chats are unreachable by address bar · P1
- Evidence: chat-router.tsx:72 — all navigation is component state; no route/query/history entry ever written. Reload always lands on the list.
- Benchmark: ChatGPT/Claude.ai `/c/<id>`; Cursor per-project history; Claude Code `--resume <id>`. Every benchmark can re-enter a specific thread.
- Recommendation: Encode sessionId + view kind in the URL; restore on mount. Also unlocks browser back/forward.
- Effort: M

#### CHAT-D9-02 · Search matches titles/paths only, not message content · P2
- Evidence: chat-list.tsx:162-166.
- Benchmark: ChatGPT/Claude.ai index message bodies — "where did we discuss X" is the dominant recall query.
- Recommendation: Server-side transcript grep endpoint; merge content hits with snippets.
- Effort: M

#### CHAT-D9-03 · No pin or archive · P2
- Evidence: chat-list.tsx:586-624 — only per-row action is delete; header (:1745-1792) offers voice/debug/delete.
- Recommendation: `pinned`/`archived` flags on SessionRow; pinned float, archived behind a filter.
- Effort: M

#### CHAT-D9-04 · No in-transcript search or jump-to-message · P2
- Evidence: chat-view.tsx:1796-1902 — no find UI; ⌘F belongs to ChatList (session search). Browser-native find works only because nothing is virtualized — D10-02 work would silently break it.
- Recommendation: In-transcript find bar (highlight + next/prev) landed together with any virtualization.
- Effort: M

#### CHAT-D9-05 · No conversation export or share · P3
- Evidence: header actions and slash catalog contain nothing transcript-shaped.
- Benchmark: Claude Code `/export`; ChatGPT/Claude.ai share links. For local-first, markdown export is the relevant form.
- Recommendation: `/export` (markdown to clipboard/file) reusing the loaded `turns` array.
- Effort: S

#### CHAT-D9-06 · Session list: full render of every row, frozen relative times · P3
- Evidence: chat-list.tsx:481-632 — no cap/pagination; `age()` (:40-54) computed at render with no timer.
- Recommendation: Per-group "show more" cap; refresh ages on a 30-60 s interval.
- Effort: S

### D10 · Scroll & reading ergonomics — 2/5

#### CHAT-D10-01 · Pin-to-bottom fights the reader: smooth `scrollIntoView` on every SSE chunk, 80px capture zone · P1
- Evidence: chat-view.tsx:1132-1134 — smooth scroll fired on every `turns` mutation while `atBottom`; threshold 80px (:1140). Every chunk queues a fresh smooth animation; within 80px of bottom each chunk re-yanks the reader, and the animation's own scroll events keep `atBottom` true. Also ignores `prefers-reduced-motion` (see D13-03). Live: FAB appears on wheel-up (credit); pin-release timing could not be measured deterministically in the harness — code evidence stands.
- Benchmark: ChatGPT — releases the pin on user scroll *intent* (wheel/touch delta, not position), pins with instant content-anchored scrolling, never a queued animation per token.
- Recommendation: Pin via `scrollTop = scrollHeight` inside rAF; release on wheel/touchmove with negative delta; re-pin only via FAB or true bottom.
- Effort: M

#### CHAT-D10-02 · No transcript virtualization; O(n²) render bookkeeping; single unpaginated history fetch · P2
- Evidence: chat-view.tsx:1857-1899 — every turn rendered; each row does `allTurns.indexOf(t)` (:1860, :1883) making render O(n²); history is one fetch (:1034). Live measurement tempers urgency: a 200-turn session with code blocks loaded in 377 ms, 6,726 DOM nodes, ~100 fps scroll sweep — fine at 200, untested risk at 1,000+.
- Recommendation: Short-term: pass the map index instead of `indexOf`, memoize TurnRow. Medium: `content-visibility: auto` per turn, then pagination.
- Effort: M

#### CHAT-D10-03 · Scroll FAB carries no "new messages" signal · P3
- Evidence: chat-view.tsx:1905-1917 — renders when `!atBottom`; nothing counts content arriving below the fold.
- Benchmark: ChatGPT's jump-to-latest appears specifically when new content streams below; Slack/Discord show counts.
- Effort: S

#### CHAT-D10-04 · Unbounded line length in the shipped linear layout · P2
- Evidence: cave-chat.css:1002-1007, 1037-1041 — linear variant is `max-width: 100%`; the 920px cap (:641-645) only applies to the workbench variant, but ChatView renders `cave-chat-linear` (chat-view.tsx:1697). On a wide pane, prose runs 150+ chars/line.
- Benchmark: Claude.ai ~48rem; ChatGPT ~768px; 45-90 chars/line is the typographic norm.
- Recommendation: `max-width: min(100%, 920px); margin-inline: auto` (or `72ch`) on the linear content, mirroring the workbench cap.
- Effort: S

### D11 · Keyboard & focus model — 3/5

*(Primary failure — hover-gated message actions — is D6-04.)*

#### CHAT-D11-01 · Incoherent Esc layering · P2
- Evidence: chat-view.tsx:1636-1639 — composer Esc only cancels when busy: with the slash menu open it does nothing (live-verified), and with the menu open *while busy* it cancels the live stream instead of closing the menu. AttachmentLightbox (:2391-2395) and MarkdownExpandModal (message-bubble.tsx:679-683) attach independent window-level Esc listeners with no coordination.
- Benchmark: Claude Code/ChatGPT — strict precedence: menu > modal > stream-cancel, one consumer per keypress.
- Recommendation: Handle Esc in priority order in `onComposerKey` (dismiss menu → busy-cancel); route modal Esc through the shared focus-trap path.
- Effort: S

#### CHAT-D11-02 · Expand modal and lightbox lack focus trap and restore · P2
- Evidence: message-bubble.tsx:679-683 and chat-view.tsx:2391-2395 — window keydown only; no initial focus, trap, or restore (and the trigger disappears on close per D6-04, so focus drops to body). The shared `Modal` (ui/modal.tsx:38 + use-focus-trap.ts) already does all of this correctly — the gap is adoption.
- Recommendation: Wrap both overlays in the shared Modal/useFocusTrap.
- Effort: S

#### CHAT-D11-03 · No keyboard-shortcut help surface · P2
- Evidence: no `?` sheet or shortcuts modal exists (grep verified); `/help` lists slash commands only; ⌘B/⌘\/⌘J/⌃`/⌘K discoverable only via scattered hints.
- Benchmark: ChatGPT `⌘/`; Claude Code `/help` keybindings section.
- Recommendation: `?`/`⌘/` sheet (shared Modal + `useKeySymbols` make this cheap) + a Keyboard section in `/help`.
- Effort: M

#### CHAT-D11-04 · Chat composer lacks HomeComposer's ↑↓ input history · P3
- Evidence: home-composer.tsx:181-199 vs `onComposerKey` (chat-view.tsx:1612-1640) — the app's own home surface sets the expectation, then chat breaks it.
- Recommendation: Extract a shared history hook; per-session history dovetails with D1-05's draft store.
- Effort: S

#### CHAT-D11-05 · Delete-confirm swap drops focus · P3
- Evidence: chat-view.tsx:1761-1790 — the focused trash button unmounts when confirm arms; focus falls to body.
- Recommendation: Focus the Cancel button on arm; return to trash on disarm.
- Effort: S

### D12 · Status, lifecycle & error communication — 4/5

#### CHAT-D12-01 · Up to five simultaneous status signals during one stream · P2
- Evidence: concurrent while streaming: MetaLine "writing… · esc to cancel" + blinking dot (:623-626, 698); per-turn "Writing" chip (:2226-2230); ThinkingIndicator/cursor (:2235-2236); auto-open ProgressGroup "Receiving response" (:1486-1490); composer placeholder "Streaming… (esc to cancel)" (:2047). Failures show four redundant signals.
- Benchmark: Claude Code — one status line carries phase + elapsed + esc hint.
- Recommendation: One primary live channel (per-turn area) + one ambient (MetaLine); suppress the chip while the indicator is visible; stop emitting the synthetic "Receiving response" row once text flows.
- Effort: M

#### CHAT-D12-02 · No token/cost surfaced — backend parser drops the usage fields · P2
- Evidence: route.ts:733-734 — `result` parse keeps only `duration_ms`/`is_error`; stream-json `result` events also carry `total_cost_usd`, `usage`, `num_turns`, all discarded; `done` (:1007-1012) forwards duration only.
- Benchmark: Claude Code — tokens + dollar cost per turn/session (`/cost`).
- Recommendation: Extend the result parse + `done` event with usage/cost; surface in the complete-state MetaLine (`… · 12.4k tok · $0.08`) and debug pane.
- Effort: M

#### CHAT-D12-03 · Harness-errored turn (`done.isError`) has no desktop retry affordance · P2
- Evidence: chat-view.tsx:1562 — `setLastFailedSend(request)` but `setError` never called on this path; the retry banner is gated on `error` (:1920); the only other Retry is in the mobile strip, `display: none` on desktop (cave-chat.css:902-906).
- Benchmark: ChatGPT — failed generations always show Regenerate at the turn.
- Recommendation: Render a retry affordance at the failed turn using the already-captured `lastFailedSend`.
- Effort: S

#### CHAT-D12-04 · Competing live regions; `aria-relevant="additions"` mutes streamed text · P2
- Evidence: chat-view.tsx:1797-1802 (transcript `role="log" aria-live="polite" aria-relevant="additions"`) + :698 (MetaLine `role="status" aria-live="polite"`) — double-announce risk on turn start, while chunk-by-chunk text *mutations* are never announced: SR users hear "Writing", then silence until done. The ThinkingIndicator's ticking `{elapsed}s` sits inside the live region.
- Benchmark: ChatGPT — buffered single-utterance announcement on completion.
- Recommendation: MetaLine as sole lifecycle announcer; announce the completed message once on done; exclude the ticking timer.
- Effort: S

### D13 · Visual hierarchy, density, theming & accessibility — 4/5

#### CHAT-D13-01 · Code-block & system-turn chrome hardcodes dark surfaces — breaks in light mode · P2
- Evidence: cave-chat.css:198 (`.cave-code-wrap` fixed dark oklch), :343-344 (`.cave-copy-btn` dark surface + `var(--text-muted)` ink), :1475/:1521 (system bubble dark surface + `var(--text-secondary)`). In light mode the theme tokens resolve to *dark* ink painted onto still-dark fixed surfaces — copy buttons and system output near-unreadable.
- Benchmark: Claude.ai/ChatGPT keep dark code chrome in light mode deliberately but pair it with fixed light ink, not theme tokens.
- Recommendation: Pin these surfaces' foregrounds to fixed light values (or tokenize the surfaces).
- Effort: S

#### CHAT-D13-02 · Micro-type (9-10px) on 40%-alpha muted ink · P2
- Evidence: globals.css:74 — `--text-muted` = 40% foreground mix; consumed by 10px ordinals (cave-chat.css:597-602), 10px code-header labels (:239-260), 11px meta rows (:1090-1101), 9px stat labels (chat-list.tsx:315). Roughly 2.5-3:1 contrast at sizes below every benchmark's floor. (Live axe scan flagged no contrast violations — alpha-composited text evades automated checks; the computed values stand.)
- Recommendation: Raise `--text-muted` toward 55-60%; lift 9px labels to 10-11px, keep eyebrow tracking for hierarchy.
- Effort: S

#### CHAT-D13-03 · Smooth autoscroll ignores `prefers-reduced-motion` · P3
- Evidence: chat-view.tsx:1133, :1910 — explicit `behavior: "smooth"` is not overridden by the global `scroll-behavior: auto !important` kill switch (globals.css:270-275) per the CSSOM View spec.
- Recommendation: Gate on `matchMedia("(prefers-reduced-motion: reduce)")` — same fix point as D10-01.
- Effort: S

#### CHAT-D13-04 · Focus-ring utility applied inconsistently · P3
- Evidence: rename-title button (chat-view.tsx:534-536), starter chips (:404-413), slash rows (:1948-1971), and the FAB (:1905-1917) omit `focus-ring` while sibling controls carry it.
- Recommendation: Add `focus-ring`/`focus-ring-inset` to the stragglers.
- Effort: S

#### CHAT-D13-05 · Landmark hygiene (live axe findings) · P3
- Evidence: axe on a loaded chat: `landmark-complementary-is-top-level` (aside nested in another landmark), `landmark-unique` (duplicate landmark names), `page-has-heading-one` (no h1). All moderate.
- Recommendation: Label/uniquify the panel landmarks; give the chat view a (visually-hidden) h1.
- Effort: S

## 5. Prioritized remediation backlog

Ranked by severity × effort × dependency order. S/M/L = small/medium/large.

| Rank | ID | Title | Sev | Effort | Dimension |
|---|---|---|---|---|---|
| 1 | CHAT-D2-01 | Slash menu: Enter runs highlighted item, Esc dismisses, unknown commands surface feedback (un-dead-code the guard) | P0 | S | D2 |
| 2 | CHAT-D7-01 | Wire copy buttons in SyntaxBlock/MarkdownBlock (delegated listener) | P0 | S | D7 |
| 3 | CHAT-D5-01 | Stop destroying input typed mid-stream (busy check before clear; then a real queue) | P1 | S→M | D5 |
| 4 | CHAT-D6-04 | Always-render message actions, CSS-gated (keyboard/touch reach) | P1 | S | D6/D11 |
| 5 | CHAT-D1-01 | Deliver image attachments to the harness (or block with notice) | P0 | M | D1 |
| 6 | CHAT-D3-01 | Progressive markdown rendering during stream (kills the CLS 0.53 completion reflow) | P1 | M | D3/D7 |
| 7 | CHAT-D10-01 | Scroll: instant pin, intent-based release (+ reduced-motion gate, D13-03) | P1 | M | D10 |
| 8 | CHAT-D1-02/03 | Paste-to-attach + drag-and-drop attach | P1 | S+S | D1 |
| 9 | CHAT-D6-01 | Edit-and-resend user messages | P1 | M | D6 |
| 10 | CHAT-D6-02 | Regenerate assistant turns | P1 | M | D6 |
| 11 | CHAT-D12-03 | Desktop retry affordance for harness-errored turns | P2 | S | D12 |
| 12 | CHAT-D9-01 | URL deep-links to chats (back/forward, reload survival) | P1 | M | D9 |
| 13 | CHAT-D10-04 | Line-length cap in the linear layout | P2 | S | D10 |
| 14 | CHAT-D5-02 | Persist cancelled turns as cancelled (not fabricated errors) | P2 | S | D5 |
| 15 | CHAT-D4-02 | One-line arg summaries on collapsed tool rows | P2 | S | D4 |
| 16 | CHAT-D11-01/02 | Esc precedence + adopt shared Modal in the two trap-less overlays | P2 | S | D11 |
| 17 | CHAT-D2-04 | Combobox ARIA on slash menus (both composers) | P2 | S | D2 |
| 18 | CHAT-D13-01 | Fix light-mode code/system chrome ink | P2 | S | D13 |
| 19 | CHAT-D12-01 | Consolidate streaming status signals | P2 | M | D12 |
| 20 | CHAT-D12-02 | Surface tokens/cost from the result event | P2 | M | D12 |
| 21 | CHAT-D4-01 | Interleave tool calls chronologically (ordered segment model) | P1 | L | D4 |
| 22 | CHAT-D8-02 | Render Edit-tool calls as structured diffs | P2 | M | D8 |
| 23 | CHAT-D4-03/04 | Tool id collisions; map envelope tool_use blocks | P2 | S+M | D4 |
| 24 | CHAT-D1-04 | `@`-mention repo-file picker | P1 | L | D1 |
| 25 | CHAT-D8-01 | Files-changed summary + per-file revert (first step toward review workflow) | P1 | L | D8 |
| 26 | CHAT-D9-02/03/04 | Content search, pin/archive, in-transcript find | P2 | M each | D9 |
| 27 | CHAT-D7-02/03/04/05 | Sticky code headers, max-height clamp, drop data-code, filename→file-preview link | P2 | S-M | D7 |
| 28 | CHAT-D11-03 | Keyboard-shortcut help sheet | P2 | M | D11 |
| 29 | CHAT-D10-02 | indexOf fix + TurnRow memo, then content-visibility/pagination | P2 | M | D10 |
| 30 | — | Remaining P3 polish (composer history parity, draft store, FAB count, micro-type, focus rings, table overflow, diff headers, export, reasoning markdown, tool-output clamp, LRU caches, elapsed-time persistence, shared ThinkingIndicator, landmarks) | P3 | S each | — |

Suggested sequencing: ranks 1-4 are one small PR each (or one combined "broken promises" PR); 5-8 are independent mediums; 9-10 should land together with a turn-store design that anticipates D6-03 branching; 21/24/25 are the strategic L items worth their own specs.

## 6. Mobile notes (ungraded)

- ✓ Visual-viewport keyboard offset, action strip (Retry/Stop/Summarize/Attach/Voice) with proper disabled states, iOS 16px no-zoom floor, `enterKeyHint="send"` (chat-view.tsx:971-981, 866-910; globals.css:320-324). Live Pixel 5 pass rendered correctly (`m2-mid-stream.png`).
- [mobile] CHAT-MOB-01 · Mobile context menu (`<details>`) has no outside-tap or Esc dismiss — floats over the transcript until re-tapped (chat-view.tsx:800-803). Effort S.
- [mobile] CHAT-MOB-02 · No newline path on soft keyboards — Enter always sends (chat-view.tsx:1631-1635 + `enterKeyHint`); multi-paragraph prompts impossible on phones. ChatGPT/Claude mobile let Enter newline and rely on the send button. Effort S.

## 7. Appendix

### Screenshot index (docs/audits/assets/chat-ux/)

| File | Shows | Findings |
|---|---|---|
| `04-mid-stream.png` | Raw ` ``` ` fences + plain text mid-stream; cursor ▌; auto-open progress; esc hint; Stop morph | D3-01 (+credits) |
| `04-done.png` | Same turn after `done` — fully re-typeset markdown | D3-01 |
| `06-tools-done-collapsed.png` | Prose, then Progress/Thinking/Tool-activity stacked below as appendix with count-only summaries | D4-01, D4-02 |
| `07-post-cancel.png` | Esc mid-stream → cancelled state, partial text retained | D5 credits |
| `10-slash-menu-open.png` | Menu with `/help` highlighted + footer "↑↓ navigate · Enter run · Tab complete · esc cancel" | D2-01 |
| `10-after-enter.png` | After Enter on `/he`: composer cleared, no feedback, nothing ran | D2-01 |
| `11-hover-actions.png` | Hover Copy on user bubble (note right-edge clipping); code chrome; table; thinking block | D6-04, D7 credits |
| `12-long-session.png` | 200-turn fixture session fully rendered | D10-02 |
| `m2-mid-stream.png` | Pixel 5 linear layout mid-stream | Mobile notes |

### Live measurements

| Scenario | Measurement |
|---|---|
| Stream completion reflow | CLS **0.53** (layout-shift observer, 40-chunk markdown stream); mid-stream DOM had 0 `<h2>`, post-done 1 — headings materialize only at completion |
| Queue-drop repro | Mid-stream Enter: send calls stayed 1, composer value `""`, message text absent from DOM — input destroyed |
| 200-turn session | Load 377 ms; 6,726 DOM nodes; ~100 fps during programmatic scroll sweep; scrollHeight 40,136 px |
| Cancel mid-stream | "Cancelled by user" shown; focus remained in composer textarea ✓ |
| Error→retry | Banner + Retry rendered; retry produced second send ✓ |
| Panel shortcuts | ⌘B collapsed nav (226→0 px), ⌘J opened agent panel (0→226 px) ✓ |
| Slash menu | 22 items; no `role="listbox"`; Esc left menu open |
| axe-core (loaded chat) | 3 moderate: `landmark-complementary-is-top-level`, `landmark-unique`, `page-has-heading-one`; no contrast flags (alpha-composited text evades automated contrast checks) |
| CSS probes | `prefers-reduced-motion` rules present ✓; `:focus-visible` rules present ✓ |

### Harness notes (for reproduction)

Throwaway spec (not committed) drove `next dev` on :3100 with `COVEN_CAVE_E2E=1`; all `/api/*` mocked via `page.route`; `/api/chat/send` mocked by an init-script `window.fetch` patch returning a paced `ReadableStream` of the real SSE frame protocol with honored AbortSignal. Onboarding suppressed via `cave:onboarding:dismissed`; daemon status mocked running. Fixture session ids `audit-fixture-*` (fresh ids — sacrificed-session trap).
