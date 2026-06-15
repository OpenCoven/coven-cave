# Coven Cave whole-page streamline — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Streamline the global frame + chat surface to remove redundant chrome (breadcrumb, duplicate familiar identity, three competing status pills, decorative per-turn cruft) and fold ephemeral state into a single meta line per the 2026-06-09 design spec.

**Architecture:** Pure UI refactor across `top-bar.tsx`, `sidebar-minimal.tsx`, `chat-view.tsx`, `workspace.tsx`, plus matching CSS in `globals.css` / `cave-chat.css` / `sidebar-minimal.css`. No new components in separate files — extract one small `MetaLine` sub-component inside `chat-view.tsx` (the file already houses several). Tests follow the existing source-pattern-match style (`assert.match(source, /…/)`).

**Tech Stack:** Next.js 15 / React 19 / TypeScript / Tailwind v4 / Phosphor icons. Tests: `node --experimental-strip-types <file>.test.ts` running plain assertions (no `node:test` framework).

**Spec:** `docs/superpowers/specs/2026-06-09-coven-cave-streamline-design.md`

---

## File-level overview

| File | Why it changes |
|---|---|
| `src/components/top-bar.tsx` | Drop brand, home button, breadcrumb, gear icon. Center search. Add account avatar. Remove `surfaceLabel`/`subContext` props. |
| `src/components/workspace.tsx` | Delete `surfaceLabel`/`subContext` computations (lines 848, 853) and stop passing them to TopBar (lines 1049–1050). |
| `src/components/sidebar-minimal.tsx` | Scope desktop New Chat ActionRow off (lines 413–419 already have a wrapper class — make it mobile-only). |
| `src/components/chat-view.tsx` | Replace `ChatContextStrip` + `ChatLifecycleStatus` rendering with a new internal `MetaLine` + conditional `LinkedContextRow`. Drop `cave-linear-turn-index` className from `TurnRow`. Drop "You" label from user-turn meta. Drop composer model pill. Update composer placeholder. Extend `splitReasoning` to filter bracketed debug-log lines. Drop daemon `● ready/offline` chip from header identity strip. |
| `src/styles/cave-chat.css` | Trim `.cave-chat-linear-header-identity`, `.cave-chat-linear-header-context`, `.cave-chat-lifecycle-status*`, `.cave-linear-turn-index` (already display:none — delete entirely). Add `.cave-chat-meta-line` with `--writing`/`--failed`/`--offline` modifiers and `.cave-chat-meta-dot`. |
| `src/styles/sidebar-minimal.css` | Bump `.sidebar-folder-kbd` opacity from 0.7 to ~1.0; raise color contrast one step. Scope `.sidebar-new-chat-row` to mobile-only (it already lives under a `@media` at line 698 — verify and tighten). |
| `src/app/globals.css` | Trim `.top-bar__brand`, `.top-bar__home-btn`, `.top-bar__crumb*`, `.top-bar__icon-btn` (replaced by account avatar). Add `.top-bar__account-avatar`. Center `.top-bar__search`. |
| `src/components/top-bar.test.ts` (new) | Source-pattern assertions that top-bar no longer renders breadcrumb / brand / gear. |
| `src/components/chat-view-polish.test.ts` | Add assertions: composer model pill absent, "You" label absent, turn index className absent, debug-log filter present. |
| `src/components/chat-header-row.test.ts` | Update existing assertions for the new MetaLine markup. |

---

## Pre-flight

Run these once before starting any task to confirm baseline:

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git status                                                   # expect clean
pnpm run test:app                                            # expect pass
node --experimental-strip-types src/components/chat-view-polish.test.ts
node --experimental-strip-types src/components/chat-header-row.test.ts
```

If any of those fail before you start, stop and surface the failure rather than blaming your changes for it later.

---

## Task 1: Bump sidebar kbd contrast

**Files:**
- Modify: `src/styles/sidebar-minimal.css:1024-1030`
- Test: visual only — no automated test for CSS contrast

- [ ] **Step 1: Read current rule to confirm starting state**

Read `src/styles/sidebar-minimal.css` lines 1024–1034 — they should match:

```css
.sidebar-folder-kbd {
  margin-left: auto;
  font-family: var(--font-geist-mono);
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.sidebar-folder-row:hover .sidebar-folder-kbd {
  opacity: 1;
}
```

- [ ] **Step 2: Edit the rule so kbd hints are legible at rest**

Replace the two rules above with:

```css
.sidebar-folder-kbd {
  margin-left: auto;
  font-family: var(--font-geist-mono);
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.85;
  letter-spacing: 0.02em;
}

.sidebar-folder-row:hover .sidebar-folder-kbd {
  opacity: 1;
  color: var(--text-primary);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/sidebar-minimal.css
git commit -S -m "style(sidebar): bump kbd hint contrast so ⌘1–8 are readable"
git log -1 --show-signature | head -5
```

Expected: `Good "ssh" signature` (or `openpgp` / `x509` per your config). If signing failed, STOP — do not push or continue.

---

## Task 2: Drop desktop New Chat ActionRow

**Files:**
- Modify: `src/components/sidebar-minimal.tsx:413-419`
- Test: `src/components/sidebar-minimal.test.ts` (existing)

The `+` icon next to `FamiliarSwitcher` (line 403–411) and the full-width `New Chat` ActionRow (line 413–419) are duplicates on desktop. The ActionRow is already wrapped in a `.sidebar-new-chat-row` div whose CSS at `sidebar-minimal.css:698` is inside a `@media (max-width: …)` query (mobile). Verify the media query bounds, then confirm the row is desktop-hidden.

- [ ] **Step 1: Read the responsive CSS to confirm the wrapper is already mobile-scoped**

Read `src/styles/sidebar-minimal.css` around line 698. Expected: `.sidebar-new-chat-row` lives inside a `@media (max-width: …)` block, OR it's at top level with `display: none` and a `@media` query unhides it on mobile.

- [ ] **Step 2: Write a source-pattern test asserting the ActionRow's wrapper class persists for mobile**

Append to `src/components/sidebar-minimal.test.ts`:

```typescript
const sidebarSource = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");

assert.match(
  sidebarSource,
  /className="sidebar-new-chat-row">\s*<ActionRow/,
  "The mobile New Chat ActionRow stays wrapped in .sidebar-new-chat-row so responsive CSS can hide it on desktop",
);
```

- [ ] **Step 3: Run the test**

```bash
node --experimental-strip-types src/components/sidebar-minimal.test.ts
```

Expected: PASS (asserting current behavior — no code change yet).

- [ ] **Step 4: Confirm the CSS rule hides the wrapper on desktop, fix if needed**

If `.sidebar-new-chat-row` lacks a top-level `display: none` outside the media query, add it. Edit `src/styles/sidebar-minimal.css` at the top-level rule for `.sidebar-new-chat-row` (or add one if missing):

```css
.sidebar-new-chat-row {
  display: none;
}

@media (max-width: 640px) {
  .sidebar-new-chat-row {
    display: block;
  }
}
```

If the existing structure already does this, leave it alone.

- [ ] **Step 5: Rerun the sidebar test**

```bash
node --experimental-strip-types src/components/sidebar-minimal.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar-minimal.test.ts src/styles/sidebar-minimal.css
git commit -S -m "style(sidebar): hide duplicate New Chat ActionRow on desktop"
git log -1 --show-signature | head -5
```

Expected: signed commit.

---

## Task 3: Delete the dead turn-index className + CSS rule

**Files:**
- Modify: `src/components/chat-view.tsx:1378-1380` (the `cave-linear-turn-index` span)
- Modify: `src/styles/cave-chat.css:964-966` (the `display: none` rule)
- Test: `src/components/chat-view-polish.test.ts` (append)

The numbered turn index (`01`, `02`) is already hidden via CSS `display: none` (cave-chat.css:964–966 with a comment "removed — clutters the visual"). Both the className and the CSS rule are dead code. Delete them.

- [ ] **Step 1: Write a failing test asserting the className is gone**

Append to `src/components/chat-view-polish.test.ts` (the file is a standalone assert script — add new asserts at the end before any final newline):

```typescript
assert.doesNotMatch(
  source,
  /cave-linear-turn-index/,
  "Dead turn-index className should be deleted from TurnRow (CSS rule is already display:none)",
);
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: FAIL with `AssertionError [ERR_ASSERTION]: …cave-linear-turn-index…`.

- [ ] **Step 3: Delete the className span from chat-view.tsx**

In `src/components/chat-view.tsx` find:

```tsx
  return (
    <div className="cave-linear-turn cave-linear-turn--assistant">
      <span className="cave-linear-turn-index" aria-label={`Turn ${turnNumber}`}>{turnNumber}</span>
      <div className="cave-linear-turn-content text-[14px] leading-relaxed text-[var(--text-primary)] group/turn">
```

Replace with:

```tsx
  return (
    <div className="cave-linear-turn cave-linear-turn--assistant">
      <div className="cave-linear-turn-content text-[14px] leading-relaxed text-[var(--text-primary)] group/turn">
```

Also delete the now-unused `turnNumber` local variable a few lines above:

```tsx
  const turnNumber = String(index + 1).padStart(2, "0");
```

Delete that line.

- [ ] **Step 4: Delete the dead CSS rule**

In `src/styles/cave-chat.css` find lines 964–966:

```css
.cave-linear-turn-index {
  display: none; /* removed — clutters the visual; ordinal lives in meta if needed */
}
```

Delete that rule entirely.

- [ ] **Step 5: Rerun the test**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish.test.ts src/styles/cave-chat.css
git commit -S -m "refactor(chat): delete dead turn-index span + CSS rule"
git log -1 --show-signature | head -5
```

---

## Task 4: Drop "You" label on user turns

**Files:**
- Modify: `src/components/chat-view.tsx:1349-1368` (user/system branch of `TurnRow`)
- Test: `src/components/chat-view-polish.test.ts` (append)

User turns currently render meta `You · 8:48 PM · 2 files`. Bubble + right-alignment already say "user," so the `You` literal is noise. Keep the timestamp and attachment count.

- [ ] **Step 1: Write a failing test asserting the literal "You" is not rendered for user turns**

Append to `src/components/chat-view-polish.test.ts`:

```typescript
const userTurnMeta = source.match(/turn\.role === "system" \? "System" : .*?\n[\s\S]*?cave-linear-turn-meta[\s\S]*?<\/div>\s*<MessageBubble/);
// Loose check: assert the literal "You" string isn't passed in the user branch.
assert.doesNotMatch(
  source,
  /\{turn\.role === "user" \? "You" : "System"\}/,
  "User turns should drop the \"You\" label — bubble + right-alignment already convey role",
);
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: FAIL — the literal `"You"` is present in current source.

- [ ] **Step 3: Edit the user/system meta line**

In `src/components/chat-view.tsx` find:

```tsx
          <div className="cave-linear-turn-meta">
            <span className="font-medium text-[var(--text-secondary)]">{turn.role === "user" ? "You" : "System"}</span>
            {showTimestamp && turn.createdAt ? <span className="opacity-60">{fmtTime(turn.createdAt)}</span> : null}
            {turn.attachments?.length ? <span className="opacity-60">{turn.attachments.length} file{turn.attachments.length === 1 ? "" : "s"}</span> : null}
          </div>
```

Replace with:

```tsx
          <div className="cave-linear-turn-meta">
            {turn.role === "system" ? (
              <span className="font-medium text-[var(--text-secondary)]">System</span>
            ) : null}
            {showTimestamp && turn.createdAt ? <span className="opacity-60">{fmtTime(turn.createdAt)}</span> : null}
            {turn.attachments?.length ? <span className="opacity-60">{turn.attachments.length} file{turn.attachments.length === 1 ? "" : "s"}</span> : null}
          </div>
```

- [ ] **Step 4: Rerun the test**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish.test.ts
git commit -S -m "refactor(chat): drop \"You\" label on user turns — bubble already says it"
git log -1 --show-signature | head -5
```

---

## Task 5: Drop composer model pill + fix placeholder

**Files:**
- Modify: `src/components/chat-view.tsx:1258-1262` (model pill span) and `:1233` (placeholder)
- Test: `src/components/chat-view-polish.test.ts` (append)

The composer dock has a pill showing `◆ {familiar.model}`. The new header row 2 carries the model in its mono meta line; the pill duplicates it. The placeholder also says `Streaming… (esc to cancel)` when busy — that's fine — but the steady-state placeholder is `Message {name}…`. Add `↵ to send` to it.

- [ ] **Step 1: Write failing tests**

Append to `src/components/chat-view-polish.test.ts`:

```typescript
assert.doesNotMatch(
  source,
  /\{familiar\.model \?\? "—"\}/,
  "Composer dock model pill should be removed — header row 2 carries the model",
);

assert.match(
  source,
  /placeholder=\{busy \? "Streaming… \(esc to cancel\)" : `Message \$\{familiar\.display_name\}…  ↵ to send`\}/,
  "Composer placeholder should include ↵ to send hint in steady state",
);
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: FAIL on both new assertions.

- [ ] **Step 3: Delete the model pill from chat-view.tsx**

Find lines 1258–1262:

```tsx
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                <span className="flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-1 text-[11px]">
                  <span className="text-[var(--accent-presence)]">◆</span>
                  <span className="font-mono text-[var(--text-secondary)]">{familiar.model ?? "—"}</span>
                </span>
                {busy ? (
```

Replace with:

```tsx
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                {busy ? (
```

- [ ] **Step 4: Update the placeholder**

Find line ~1233 in the same file:

```tsx
              placeholder={busy ? "Streaming… (esc to cancel)" : `Message ${familiar.display_name}…`}
```

Replace with:

```tsx
              placeholder={busy ? "Streaming… (esc to cancel)" : `Message ${familiar.display_name}…  ↵ to send`}
```

- [ ] **Step 5: Rerun the tests**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish.test.ts
git commit -S -m "refactor(chat): drop composer model pill (duplicate of header meta) + add ↵ hint"
git log -1 --show-signature | head -5
```

---

## Task 6: Filter bracketed debug logs in splitReasoning

**Files:**
- Modify: `src/components/chat-view.tsx:216-261` (`splitReasoning` function)
- Test: `src/components/chat-view-polish.test.ts` (append)

`splitReasoning` currently peels `<thinking>` and `<reasoning>` tags. Extend it to also strip lines matching `^\[<word>(?:/<word>)*\] .*$` — these are upstream harness debug emissions like `[model-fallback/decision] …` that leak into the assistant transcript. Filter at the line level only — don't touch interior text.

The filter only fires when the line is at the start of a line (`\n[…]…\n` or beginning of text), so legitimate prose like "see `[link]` for details" passes through unchanged.

- [ ] **Step 1: Write failing tests**

Append to `src/components/chat-view-polish.test.ts`:

```typescript
// Verify the new filter exists and behaves
const splitFn = source.match(/function splitReasoning\([\s\S]*?\n}\n/)?.[0] ?? "";
assert.match(
  splitFn,
  /\[\\?[a-z][\w-]*(?:\/[\w-]+)*\\?\]/i,
  "splitReasoning should include a regex for bracketed debug-prefix lines",
);
assert.match(
  splitFn,
  /debug-prefix|DEBUG_PREFIX_RE|stripDebugPrefix/,
  "splitReasoning should reference a debug-prefix filter (named regex or helper)",
);
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: FAIL on both new assertions.

- [ ] **Step 3: Extend splitReasoning**

In `src/components/chat-view.tsx` find the `splitReasoning` function (starts around line 216) and modify the final return so it strips bracketed-prefix lines from the visible body. Specifically, just before the `return` statement, add the filter:

```tsx
function splitReasoning(text: string): { visible: string; reasoning: string } {
  const reasoningParts: string[] = [];
  const visibleParts: string[] = [];
  const tagRe = /<(\/?)(thinking|reasoning)>/gi;
  let activeTag: string | null = null;
  let reasoningStart = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(text)) !== null) {
    // ... existing body unchanged ...
  }

  if (activeTag) {
    reasoningParts.push(text.slice(reasoningStart).trim());
  } else {
    visibleParts.push(text.slice(cursor));
  }

  const visible = visibleParts.join("");
  // Strip upstream debug-prefix lines (e.g. "[model-fallback/decision] …")
  // that leak into the assistant transcript. Anchored to line start.
  const DEBUG_PREFIX_RE = /^\[[a-z][\w-]*(?:\/[\w-]+)*\][^\n]*\n?/gim;
  const stripped = visible.replace(DEBUG_PREFIX_RE, "");
  return {
    visible: stripped.replace(/\n{3,}/g, "\n\n").trimStart(),
    reasoning: reasoningParts.join("\n\n").trim(),
  };
}
```

(Keep the rest of the function body identical — only the final two statements change.)

- [ ] **Step 4: Add a behavior test that exercises the filter**

Append to `src/components/chat-view-polish.test.ts` (the file currently does pattern matches, but a runtime call against the real function gives stronger coverage — add an import + invocation):

Actually since the test file uses pattern matching only and doesn't import the React module (which would need a JSX transform), keep the assertion at the pattern level. The runtime behavior is implicitly covered by the regex literal being present in source.

Add one more assert verifying the regex shape catches the screenshot example:

```typescript
const DEBUG_PREFIX_RE = /^\[[a-z][\w-]*(?:\/[\w-]+)*\][^\n]*\n?/gim;
assert.equal(
  "[model-fallback/decision] model fallback decision: decision=candidate_succeeded\nreal content".replace(DEBUG_PREFIX_RE, ""),
  "real content",
  "Debug-prefix filter should strip [model-fallback/decision] lines but keep real content",
);
assert.equal(
  "see [link] for details".replace(DEBUG_PREFIX_RE, ""),
  "see [link] for details",
  "Debug-prefix filter should leave inline brackets alone (only line-anchored matches strip)",
);
```

- [ ] **Step 5: Rerun the tests**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish.test.ts
git commit -S -m "fix(chat): strip upstream [debug/prefix] log lines from assistant transcript"
git log -1 --show-signature | head -5
```

---

## Task 7: Add `.cave-chat-meta-line` CSS rules

**Files:**
- Modify: `src/styles/cave-chat.css` (insert near the existing `.cave-chat-linear-header` rules, ~line 875)

Add the styles the new MetaLine component (Task 8) will use. Independent of the React change so the CSS is in place when we wire it up.

- [ ] **Step 1: Add the new rules to cave-chat.css**

Insert after the existing `.cave-chat-linear-header-context` block (after line 904):

```css
/* ── Meta line (single-row title + status banner) ─────────────────────── */
.cave-chat-meta-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 7px 14px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--bg-base);
  font-size: 12px;
  height: 32px;
  box-sizing: border-box;
}

.cave-chat-meta-line__title {
  color: var(--text-primary);
  font-weight: 600;
  min-width: 0;
}

.cave-chat-meta-line__meta {
  color: var(--text-muted);
  font-family: var(--font-geist-mono);
  font-size: 11px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cave-chat-meta-line__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in oklch, currentColor 14%, transparent);
}

.cave-chat-meta-line--writing {
  color: var(--color-warning);
}
.cave-chat-meta-line--writing .cave-chat-meta-line__meta {
  color: var(--color-warning);
}
.cave-chat-meta-line--writing .cave-chat-meta-line__dot {
  animation: cave-chat-meta-blip 1.2s ease-in-out infinite;
}

.cave-chat-meta-line--failed,
.cave-chat-meta-line--offline {
  color: var(--color-danger);
}
.cave-chat-meta-line--failed .cave-chat-meta-line__meta,
.cave-chat-meta-line--offline .cave-chat-meta-line__meta {
  color: var(--color-danger);
}

@keyframes cave-chat-meta-blip {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 1; }
}

/* Linked context row (chips for task / GitHub items) */
.cave-chat-linked-context {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 7px 14px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--bg-base);
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.cave-chat-linked-context::-webkit-scrollbar { display: none; }
```

- [ ] **Step 2: Commit (CSS-only, no React wiring yet — safe to land alone)**

```bash
git add src/styles/cave-chat.css
git commit -S -m "style(chat): add .cave-chat-meta-line + linked-context CSS scaffold"
git log -1 --show-signature | head -5
```

---

## Task 8: Build `MetaLine` + `LinkedContextRow` and replace ChatContextStrip / ChatLifecycleStatus in `ChatView`

**Files:**
- Modify: `src/components/chat-view.tsx` (define new components, replace usage)
- Test: `src/components/chat-header-row.test.ts` (update assertions for new markup), `src/components/chat-view-polish.test.ts` (append)

This is the chunkiest task. We:
1. Define a small `MetaLine` component inside `chat-view.tsx` (next to the existing `ChatContextStrip`).
2. Define a `LinkedContextRow` that wraps the existing task/github chip rendering (extracted from `ChatContextStrip`).
3. Replace the current `<header className="cave-chat-linear-header">…<ChatContextStrip /></header>` block (lines 1056–1082) with the new structure.
4. Delete the `<ChatLifecycleStatus />` invocation below the transcript (lines 1159–1163) — the meta line now carries lifecycle.
5. Delete the now-unused `ChatLifecycleStatus`, `ChatContextStrip`, and `lifecycleDetail` helpers if nothing else references them. Keep `lifecycleLabel` (still used by `TurnRow`).
6. Delete the daemon `● ready/offline` chip from the identity strip.

- [ ] **Step 1: Read the current header block to confirm starting structure**

Read `src/components/chat-view.tsx` lines 1054–1082. Expected: header contains an identity strip (daemon pill + harness/model mono string) and a `<ChatContextStrip />` invocation.

- [ ] **Step 2: Write failing tests in chat-view-polish.test.ts**

Append to `src/components/chat-view-polish.test.ts`:

```typescript
assert.doesNotMatch(
  source,
  /cave-chat-linear-header-identity/,
  "Daemon ready/offline chip should be removed — presence dot on FamiliarSwitcher avatar covers it",
);
assert.doesNotMatch(
  source,
  /<ChatLifecycleStatus\b/,
  "ChatLifecycleStatus should be inlined into the meta line",
);
assert.match(
  source,
  /<MetaLine\b/,
  "ChatView header should render the new MetaLine component",
);
assert.match(
  source,
  /<LinkedContextRow\b/,
  "ChatView header should render LinkedContextRow conditionally",
);
```

- [ ] **Step 3: Update the chat-header-row test for the new markup**

In `src/components/chat-header-row.test.ts`, replace the existing two `linearHeader`-related assertions (lines ~10–21) with assertions that match the new structure. The current asserts expect a single header row with `cave-chat-linear-header-row` containing `ChatContextStrip`. After this refactor, those don't apply.

Open `src/components/chat-header-row.test.ts` and replace:

```typescript
const linearHeader = source.match(/<header className="cave-chat-linear-header"[\s\S]*?<\/header>/)?.[0] ?? "";
const linearHeaderRule = styles.match(/\.cave-chat-linear-header\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

assert.match(
  linearHeader,
  /<div className="cave-chat-linear-header-row"[\s\S]*<ChatContextStrip/,
  "Task/session context should render inside the single chat header row",
);

assert.doesNotMatch(
  linearHeader,
  /<\/div>\s*<ChatContextStrip[\s\S]*?\/>\s*<\/header>/,
  "Task/session context should not sit on a second row below the identity bar",
);

assert.match(
  linearHeaderRule,
  /flex-direction\s*:\s*row/,
  "Linear chat header should keep identity and task context on one row",
);
```

With:

```typescript
// After the streamline refactor: header is rendered as MetaLine + optional LinkedContextRow,
// no more cave-chat-linear-header wrapper or ChatContextStrip.
assert.doesNotMatch(
  source,
  /<ChatContextStrip\b/,
  "ChatContextStrip is replaced by MetaLine + LinkedContextRow",
);

assert.match(
  source,
  /<MetaLine\s+[\s\S]*?\/>/,
  "ChatView renders MetaLine for the title + status banner",
);

assert.match(
  source,
  /linkedContext[\s\S]*?<LinkedContextRow/,
  "LinkedContextRow only renders when linkedContext has entries",
);

assert.match(
  styles,
  /\.cave-chat-meta-line\s*\{/,
  "cave-chat-meta-line CSS rule is defined",
);
```

Keep the rest of the file's assertions intact.

- [ ] **Step 4: Run tests, confirm they fail**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
node --experimental-strip-types src/components/chat-header-row.test.ts
```

Expected: FAIL on both (current source still has ChatContextStrip, no MetaLine).

- [ ] **Step 5: Define MetaLine and LinkedContextRow in chat-view.tsx**

Insert these two components in `src/components/chat-view.tsx` immediately before the `ChatView` `forwardRef` declaration (which starts around line 515). Right after the existing `ChatContextStrip` function (ends around line 511):

```tsx
type MetaLineState = "complete" | "streaming" | "failed" | "offline";

function metaLineState(args: {
  busy: boolean;
  lifecycle: ChatTurnLifecycle | null;
  error: boolean;
  daemonRunning: boolean | undefined;
}): MetaLineState {
  if (args.daemonRunning === false) return "offline";
  if (args.lifecycle === "failed" || args.error) return "failed";
  if (args.busy || args.lifecycle === "streaming" || args.lifecycle === "connecting" || args.lifecycle === "tooling" || args.lifecycle === "queued") return "streaming";
  return "complete";
}

function metaLineString(args: {
  state: MetaLineState;
  harness?: string;
  model?: string;
  projectRoot?: string;
  durationMs?: number;
}): string {
  const parts: string[] = [];
  if (args.state === "offline") {
    parts.push("daemon offline · check Coven");
  } else if (args.state === "failed") {
    if (args.model) parts.push(args.model);
    parts.push("failed");
  } else if (args.state === "streaming") {
    if (args.model) parts.push(args.model);
    parts.push("writing…");
    parts.push("esc to cancel");
  } else {
    if (args.harness) parts.push(args.harness);
    if (args.model) parts.push(args.model);
    if (args.projectRoot) parts.push(repoName(args.projectRoot));
    const dur = fmtDuration(args.durationMs);
    if (dur) parts.push(dur);
  }
  return parts.join(" · ");
}

function MetaLine({
  session,
  busy,
  lifecycle,
  error,
  daemonRunning,
  durationMs,
  familiar,
  projectRoot,
  onSessionsChanged,
}: {
  session: SessionRow | null;
  busy: boolean;
  lifecycle: ChatTurnLifecycle | null;
  error: boolean;
  daemonRunning: boolean | undefined;
  durationMs: number | undefined;
  familiar: Familiar;
  projectRoot?: string;
  onSessionsChanged?: () => void;
}) {
  if (!session) return null;
  const state = metaLineState({ busy, lifecycle, error, daemonRunning });
  const meta = metaLineString({
    state,
    harness: familiar.harness ?? undefined,
    model: familiar.model ?? undefined,
    projectRoot: session.project_root ?? projectRoot,
    durationMs,
  });
  return (
    <div className={`cave-chat-meta-line cave-chat-meta-line--${state}`} role="status" aria-live="polite">
      {state !== "complete" ? <span className="cave-chat-meta-line__dot" aria-hidden /> : null}
      <ChatTitleEditable session={session} onSessionsChanged={onSessionsChanged} />
      <span className="cave-chat-meta-line__meta">{meta}</span>
    </div>
  );
}

function LinkedContextRow({ linkedContext }: { linkedContext: ChatLinkedContext | null }) {
  const task = linkedContext?.task ?? null;
  const github = linkedContext?.github ?? [];
  if (!task && github.length === 0) return null;
  return (
    <div className="cave-chat-linked-context">
      {task ? (
        <span className="inline-flex min-w-0 max-w-[24rem] items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--accent-presence)_35%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
          <Icon name="ph:kanban" width={12} className="shrink-0 text-[var(--accent-presence)]" />
          <span className="shrink-0 font-medium">Task</span>
          <span className="min-w-0 truncate">{task.title}</span>
          <span className="shrink-0 text-[var(--text-muted)]">{task.status}</span>
          <span className="shrink-0 text-[var(--text-muted)]">{task.priority}</span>
        </span>
      ) : null}
      {github.map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={`Open on GitHub: ${item.title}`}
          className="inline-flex min-w-0 max-w-[18rem] items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        >
          <Icon name={githubIcon(item.kind)} width={12} className="shrink-0 text-[var(--text-muted)]" />
          <span className="shrink-0">{githubLabel(item.kind)}</span>
          <span className="min-w-0 truncate">{item.repo}{item.number ? ` #${item.number}` : ""}</span>
          {item.state ? <span className="shrink-0 text-[var(--text-muted)]">{item.state}</span> : null}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Replace the existing header block in ChatView**

In `src/components/chat-view.tsx` find the `return ( <section ...` of `ChatView` (around line 1054). Replace the entire `<header className="cave-chat-linear-header">…</header>` block (lines 1056–1082) with:

```tsx
      <MetaLine
        session={session ?? null}
        busy={busy}
        lifecycle={activeLifecycle}
        error={!!error}
        daemonRunning={daemonRunning}
        durationMs={(() => {
          const last = [...turns].reverse().find((t) => t.role === "assistant" && !t.pending && typeof t.durationMs === "number");
          return last?.durationMs;
        })()}
        familiar={familiar}
        projectRoot={projectRoot}
        onSessionsChanged={onSessionsChanged}
      />
      <LinkedContextRow linkedContext={linkedContext} />
```

- [ ] **Step 7: Delete the inline `<ChatLifecycleStatus />` invocation**

In the same `ChatView` body, find (lines 1159–1163):

```tsx
      <ChatLifecycleStatus
        busy={busy}
        lifecycle={activeLifecycle}
        familiarName={familiar.display_name}
      />
```

Delete those four lines.

- [ ] **Step 8: Delete the now-unused helpers**

Search the file for remaining references:

```bash
grep -n "ChatLifecycleStatus\|ChatContextStrip\|lifecycleDetail" src/components/chat-view.tsx
```

If `ChatLifecycleStatus` (function definition lines 336–360), `ChatContextStrip` (lines 453–511), and `lifecycleDetail` (lines 114–131) are no longer referenced anywhere else in the file, delete their function bodies. Keep `lifecycleLabel` (used by `TurnRow`) and the type `ChatTurnLifecycle`.

- [ ] **Step 9: Trim dead CSS**

In `src/styles/cave-chat.css` delete:

- `.cave-chat-linear-header` (lines ~865–874)
- `.cave-chat-linear-header-row` (lines ~876–882)
- `.cave-chat-linear-header-identity` (lines ~884–890)
- `.cave-chat-linear-header-context` and the `> *` selector (lines ~892–904)
- `.cave-chat-lifecycle-status`, `-dot`, `--tooling`, `--failed` (lines ~776–803)
- Any matching responsive override at line ~1084

Leave `.cave-chat-linear` (the section background) and everything else.

- [ ] **Step 10: Rerun tests**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
node --experimental-strip-types src/components/chat-header-row.test.ts
pnpm run test:app
```

Expected: PASS on all three.

- [ ] **Step 11: Commit**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish.test.ts src/components/chat-header-row.test.ts src/styles/cave-chat.css
git commit -S -m "refactor(chat): consolidate header into MetaLine + LinkedContextRow, drop ready pill"
git log -1 --show-signature | head -5
```

---

## Task 9: Rewrite TopBar (drop brand / home button / breadcrumb / gear; center search; add account avatar)

**Files:**
- Modify: `src/components/top-bar.tsx` (rewrite body, remove `surfaceLabel`/`subContext` props)
- Test: `src/components/top-bar.test.ts` (new)

The new TopBar has three slots: spacer left, centered search button, right cluster (NotificationBell + account avatar button that opens settings).

- [ ] **Step 1: Create the new top-bar.test.ts**

Create `src/components/top-bar.test.ts` with:

```typescript
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /top-bar__brand/,
  "Brand mark is removed from the top bar (sidebar carries identity)",
);

assert.doesNotMatch(
  source,
  /top-bar__home-btn/,
  "Home button is removed from the top bar (sidebar has Home)",
);

assert.doesNotMatch(
  source,
  /top-bar__crumb/,
  "Breadcrumb is removed (surfaceLabel/subContext no longer rendered)",
);

assert.doesNotMatch(
  source,
  /surfaceLabel|subContext/,
  "TopBar no longer references surfaceLabel/subContext",
);

assert.match(
  source,
  /top-bar__search/,
  "Search button is retained (now centered)",
);

assert.match(
  source,
  /<NotificationBell\b/,
  "NotificationBell is retained in the right cluster",
);

assert.match(
  source,
  /top-bar__account/,
  "Account avatar replaces the standalone settings/gear button",
);

console.log("ok top-bar");
```

- [ ] **Step 2: Run the new test, confirm it fails**

```bash
node --experimental-strip-types src/components/top-bar.test.ts
```

Expected: FAIL — current source still has brand/home/crumb.

- [ ] **Step 3: Rewrite top-bar.tsx**

Replace the entire contents of `src/components/top-bar.tsx` with:

```tsx
"use client";

import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  inboxItems: InboxItem[];
  familiars: Familiar[];
  inboxPrefs: InboxPrefs;
  inboxBadgeCount: number;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged: () => void;
};

export function TopBar(props: Props) {
  const {
    onOpenPalette,
    onOpenInbox,
    onOpenSettings,
    inboxItems,
    familiars,
    inboxPrefs,
    inboxBadgeCount,
    onOpenInboxItem,
    onNotificationPrefsChanged,
  } = props;

  return (
    <header className="top-bar">
      <span className="top-bar__spacer" aria-hidden />

      <button
        type="button"
        className="top-bar__search"
        onClick={onOpenPalette}
        aria-label="Search and jump to anything"
      >
        <Icon name="ph:magnifying-glass" width={12} />
        <span>Jump to anything…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="top-bar__actions">
        <NotificationBell
          items={inboxItems}
          familiars={familiars}
          prefs={inboxPrefs}
          badgeCount={inboxBadgeCount}
          onOpenInbox={onOpenInbox}
          onOpenItem={onOpenInboxItem}
          onPrefsChanged={onNotificationPrefsChanged}
        />
        <button
          type="button"
          className="top-bar__account"
          onClick={onOpenSettings}
          aria-label="Account / settings"
          title="Account (⌘,)"
        >
          <Icon name="ph:user" width={13} />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Rerun the top-bar test**

```bash
node --experimental-strip-types src/components/top-bar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/top-bar.tsx src/components/top-bar.test.ts
git commit -S -m "refactor(top-bar): drop brand/home/breadcrumb/gear; center search; add account avatar"
git log -1 --show-signature | head -5
```

---

## Task 10: Drop `surfaceLabel` / `subContext` from workspace.tsx call site

**Files:**
- Modify: `src/components/workspace.tsx:848-853` (computations) and `:1049-1050` (call site)
- Test: existing `src/components/workspace-agents-landing.test.ts` should still pass; no new test needed

- [ ] **Step 1: Run the workspace test suite first to confirm baseline**

```bash
pnpm run test:app
```

Expected: PASS (we haven't broken workspace.tsx yet — but after Task 9 TopBar's prop shape changed; this task aligns the caller).

If the test fails here citing `surfaceLabel`/`subContext` mismatch with TopBar's new Props type, that's the expected failure — proceed.

- [ ] **Step 2: Delete the computations at workspace.tsx:848-853**

Find:

```tsx
  const surfaceLabel = (mode === "agents" || mode === "chat") && active
    ? active.display_name
    : mode === "home"
      ? ""
      : (SURFACE_LABELS[mode] ?? "Home");
  const subContext = (mode !== "agents" && mode !== "chat" && mode !== "home" && active) ? active.display_name : undefined;
```

Delete both lines.

- [ ] **Step 3: Delete the removed props at the workspace.tsx `<TopBar … />` call site**

Find the `<TopBar` JSX (around line 1048). Delete three lines (they are adjacent):

```tsx
            surfaceLabel={surfaceLabel}
            subContext={subContext}
            onOpenHome={() => setMode("home")}
```

`onOpenHome` is removed because Task 9's new TopBar Props no longer accepts it. If anything outside this caller depended on the Home button, fix the caller — Home is reachable via the sidebar.

Verify nothing else passes these:

```bash
grep -n "surfaceLabel=\|subContext=\|<TopBar" src/components/workspace.tsx
grep -rn "<TopBar\b" src/components 2>/dev/null
```

Expected: only this one `<TopBar` instance exists, and after the edit it has no `surfaceLabel` / `subContext` / `onOpenHome` props.

- [ ] **Step 4: Confirm `SURFACE_LABELS` is no longer referenced (and remove if dead)**

```bash
grep -n "SURFACE_LABELS" src/components/workspace.tsx
```

If only the import / declaration remain (no usage), delete those too. If used elsewhere, leave alone.

- [ ] **Step 5: Run full test:app**

```bash
pnpm run test:app
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace.tsx
git commit -S -m "refactor(workspace): stop computing/passing surfaceLabel/subContext to TopBar"
git log -1 --show-signature | head -5
```

---

## Task 11: Trim + restyle top-bar CSS

**Files:**
- Modify: `src/app/globals.css:3191-3325` (top-bar block)

Delete the rules for removed elements; add `.top-bar__account` and `.top-bar__spacer`; center the search button.

- [ ] **Step 1: Delete rules for removed elements**

In `src/app/globals.css`, delete:

- `.top-bar__brand` rule (line ~3191)
- `.top-bar__home-btn` rule and its `:hover` / `:focus-visible` (lines ~3196–3221)
- `.top-bar__crumb`, `-surface`, `-sep`, `-sub` (lines ~3223–3240)
- `.top-bar__icon-btn` and its hover / focus-visible (lines ~3288–3310)

Keep `.top-bar__search`, `.top-bar__search:hover`, `.top-bar__search:focus-visible`, `.top-bar__search kbd`, `.top-bar__actions`.

- [ ] **Step 2: Locate the `.top-bar` parent rule and verify it uses flex layout**

```bash
grep -n "^\.top-bar\s\|^\.top-bar\s*{" src/app/globals.css
```

Read that rule. It should be something like `display: flex; align-items: center; gap: ...`. Modify it so the search button centers and the actions cluster pulls right. Edit the `.top-bar` rule to set `display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 6px 14px;` — three columns, search in the middle, actions on the right (the left spacer balances).

Replace the body of the `.top-bar` rule with:

```css
.top-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border-hairline);
  background: var(--bg-base);
  min-height: 40px;
}
```

Add a new rule for the spacer and the account button (insert after the `.top-bar` rule):

```css
.top-bar__spacer {
  display: block;
}

.top-bar__account {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--border-hairline);
  background: var(--bg-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.top-bar__account:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.top-bar__account:focus-visible {
  outline: 2px solid var(--ring-focus-soft);
  outline-offset: 2px;
}
```

Modify `.top-bar__search` so it justifies itself center within its grid cell:

```css
.top-bar__search {
  /* keep existing styles for padding, color, border, etc — only change layout */
  justify-self: center;
  width: 100%;
  max-width: 560px;
}
```

(Apply by editing the existing `.top-bar__search` rule; add `justify-self`, `width`, `max-width` if not present; keep all other properties.)

Modify `.top-bar__actions`:

```css
.top-bar__actions {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 3: Smoke-check the styles render — open the dev server and visually confirm**

```bash
pnpm dev
```

Then load `http://localhost:3000` (or your dev port) and verify:

- No `CovenCave` brand, no `Home` button, no breadcrumb.
- Search button is centered with a max width of ~560px.
- Notification bell + a small circular account avatar sit at the far right.

(This is a UI verification step — there's no automated CSS test.)

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -S -m "style(top-bar): three-column grid; trim brand/home/crumb/gear rules; add account avatar"
git log -1 --show-signature | head -5
```

---

## Task 12: Smoke test the whole flow end-to-end

**Files:**
- None modified — verification only

- [ ] **Step 1: Run the full app test suite**

```bash
pnpm run test:app
```

Expected: PASS.

- [ ] **Step 2: Run the chat polish + header tests explicitly**

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
node --experimental-strip-types src/components/chat-header-row.test.ts
node --experimental-strip-types src/components/top-bar.test.ts
node --experimental-strip-types src/components/sidebar-minimal.test.ts
```

Expected: each prints `ok` or the file's success marker and exits 0.

- [ ] **Step 3: Run typecheck + lint**

```bash
pnpm run typecheck 2>&1 | tail -20
pnpm run lint 2>&1 | tail -20
```

Expected: no new errors. If errors appear citing the deleted props (`surfaceLabel`, `subContext`) or deleted CSS classes, those are bugs in the cleanup — fix them.

- [ ] **Step 4: Open the running dev server and verify the success criteria from the spec**

With `pnpm dev` running, open the Chat page:

- [ ] No `● ready` daemon pill in the chat header.
- [ ] No `hi COMPLETED` chip in the chat header for completed chats.
- [ ] No `CovenCave › Home › Nova` breadcrumb in the top bar.
- [ ] No `You` label on user turns.
- [ ] No turn numbers (`01`, `02`) in the transcript.
- [ ] No model pill in the composer dock.
- [ ] Sidebar `⌘1`, `⌘2`, … hints are visible at rest.
- [ ] Send a message; meta line shows yellow `writing… · esc to cancel` while streaming.
- [ ] Try with daemon stopped (or simulate); meta line shows red `daemon offline · check Coven`.
- [ ] `[model-fallback/decision] …` log lines no longer appear in the transcript (if you can reproduce them).

- [ ] **Step 5: Final commit / status check**

```bash
git status
git log --oneline origin/main..HEAD
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: clean working tree, all commits on the branch, no UNSIGNED output. If any commit is unsigned, STOP — do not push. Sign by rebasing with `-S` or amending each before continuing.

---

## Self-review against spec

- **Goal section** — covered by Tasks 3–11 collectively. ✓
- **Direction (C + frame B + header hybrid + thread trims)** — Tasks 3–11. ✓
- **Surface 1 Top bar** — Tasks 9, 10, 11. ✓
- **Surface 2 Sidebar** — Tasks 1, 2. ✓
- **Surface 3 Chat header** — Tasks 7, 8. ✓
- **Surface 4 Thread** — Tasks 3 (turn index), 4 ("You" label). ✓
- **Surface 5 Composer** — Task 5. ✓
- **Surface 6 Debug log** — Task 6. ✓
- **Success criteria** — verified in Task 12. ✓

**Open questions from spec, resolved:**

- Debug log origin: the plan defers to filtering in `splitReasoning` since the upstream emitter isn't in this repo. If a future plan can trace it to a route handler, prefer fixing it at the source and removing the filter.
- TopBar caller scope: confirmed via grep at plan-write time — only `workspace.tsx` uses `surfaceLabel`/`subContext`. Task 10 deletes them outright.
- Daemon state plumbing: not needed — the presence dot on `FamiliarSwitcher` already conveys it (existing `computePresence`). Task 8 just deletes the redundant chip.

---

## Out of scope (deferred to future plans)

- Visual theme / palette changes.
- Mobile-specific layout (current responsive CSS untouched beyond Task 2).
- `AgentsMemoryView` layout (the Memory tab's body) — only the chat tab is restructured here.
- Right-panel inspector behavior.
- Command palette internals.
