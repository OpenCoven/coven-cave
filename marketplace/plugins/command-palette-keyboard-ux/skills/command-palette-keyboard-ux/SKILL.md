---
name: command-palette-keyboard-ux
description: Use when building a command palette (⌘K / Ctrl+K command bar) or keyboard-driven UX in React — the Superhuman/Linear/Vercel/Raycast/Notion pattern. Covers cmdk (Paco Coursey/Vercel, MIT, v1.1.1) as the canonical unstyled command-menu primitive (Command.Input/List/Empty/Group/Item/Separator/Dialog/Loading, filter/shouldFilter/keywords/loop/value props, ~2–3k item perf ceiling), the pages-stack nested/back-navigation pattern (Escape + Backspace-on-empty), fuzzy ranking (command-score default with exact multipliers, fzf/fzy word-boundary scoring, when to use Fuse.js/Levenshtein instead), global-vs-contextual keyboard shortcut architecture (tinykeys vs react-hotkeys-hook vs mousetrap vs kbar), shortcut philosophy (single-key/sequence vim/Gmail style vs Cocoa modifier style; press-twice conflict resolution; ? cheat sheet; platform-aware <kbd> glyph rendering; avoiding browser/OS reserved combos), recents/pinned/frecency + "did you mean"/create-fallback empty states, the command-vs-search-vs-universal-search split (Linear separate triggers vs Notion type-filtered search), WAI-ARIA combobox accessibility (role=combobox, aria-autocomplete, aria-activedescendant virtual focus + self-managed scroll, aria-live result-count announcements, high-contrast focus, screen-reader quick-nav collisions), mobile/touch degradation (Raycast desktop-only; Linear collapses to search), focus restoration on close, and the top-10 palette failure modes. Recipes: ⌘K dialog wiring, nested pages, custom fuzzy filter, contextual shortcut scoping, kbd shortcut display, live-region announcements. Role affinity cody (implementer) + charm (verb-first command labels, keyword synonyms, <40-char help text). Category Design & UI / Productivity.
---

# Command Palette & Keyboard-Driven UX — ⌘K

The command palette is a **global, keyboard-summoned overlay** (⌘K / Ctrl+K) with a free-form input that
filters a ranked list of actions/destinations/results as you type. It is the power-user surface of Linear,
Superhuman, Slack, Notion, Vercel, Figma, and Raycast. In React the canonical primitive is **`cmdk`**
(MIT, v1.1.1) — an unstyled, composable command menu that *is also an accessible combobox*; shadcn/ui ships
it as `<Command>`. The palette itself is easy; **shortcut registration, accessibility, and discoverability**
are the hard parts.

## Use When
- Your app has **more actions than fit comfortably on screen**, and/or a **keyboard-first audience**.
- You want to expose **long-tail features** that could never justify a dedicated button/menu.
- You need **unified navigation + actions + search** behind one summonable input.
- You're on **React 18+** and can render a client component (cmdk uses `useId`/`useSyncExternalStore`).

## Don't Use / Reach Elsewhere When
- **Touch/mobile is the primary target** — don't port the ⌘K overlay verbatim. Degrade to a **search-first
  bottom sheet + native controls** (Linear collapses to search; Raycast is desktop-only by design). Never
  render `<kbd>⌘K</kbd>` hints to users with no keyboard.
- **The palette would be the *only* path to an action** — it must be the fast lane *on top of* visible UI,
  never a replacement for buttons/menus. (Also an a11y requirement — see Guardrails.)
- **You need large-scale content search** (10k+ docs, typo tolerance) — that's **Fuse.js / a search index /
  server-side search**, surfaced *in* the palette via `shouldFilter={false}`, not cmdk's built-in matcher.
- **You just need one or two keybindings** and no menu — use `tinykeys`/`react-hotkeys-hook` alone; you don't
  need a palette.

## Guardrails
- **Never make a single-key shortcut the sole way to do something.** Single-key/sequence binds (`e`, `x`,
  `g i`) collide with screen-reader quick-nav keys (JAWS/NVDA use letters to jump by element) and are
  undiscoverable. Always provide a palette entry and/or a modifier-based equivalent for the same action.
- **Scope shortcuts so they don't fire in text fields.** Single-key binds triggering while the user types is
  the #1 shortcut bug. Use `react-hotkeys-hook`'s `enableOnFormTags`, Mousetrap's default input-ignore, or
  gate `tinykeys` manually.
- **Don't fight the browser/OS.** `Ctrl/Cmd+W, T, N, L, Q, F, S` are reserved. For the unavoidable conflict
  (editor `Cmd+K` = insert link), use **press-once = contextual action, press-twice = palette** (Superhuman).
- **Restore focus on close.** Save the previously focused element before opening; restore it when the palette
  closes. `Command.Dialog` (composes Radix Dialog) does this for you; a hand-rolled overlay must not.
- **Announce result changes.** Filtering silently is invisible to screen readers. Ship an `aria-live="polite"`
  region reporting the count ("42 results" / "No results"). cmdk gives you combobox roles but **not** the
  live region — you own it.
- **Discoverability is a feature, not polish.** Persistent "Search… ⌘K" hint; show each action's shortcut as
  `<kbd>` *inside* the palette (teach the fast path); `?` opens a full cheat sheet.

## The library map (npm-verified 2026-07-01)

| Need | Use | Notes |
|---|---|---|
| Command-menu **UI** (React) | **cmdk** `1.1.1` MIT | Unstyled, composable, a11y, built-in filter/sort. Canonical. |
| Batteries-included ⌘K (UI + registration + nesting) | **kbar** `0.1.0-beta.x` MIT | Plug-n-play; still beta/opinionated. |
| Fuzzy **ranking** function | **command-score** `0.1.2` MIT | cmdk's default. 0 deps. By Superhuman. |
| Global/contextual **shortcuts** (minimal) | **tinykeys** `4.0.0` MIT (~1 KB) | Key *sequences* (`g i`), no React coupling. |
| Shortcuts as a **React hook** | **react-hotkeys-hook** `5.3.3` MIT | `useHotkeys`, scopes, `enableOnFormTags`. |
| Mature vanilla keybinding | **mousetrap** `1.6.x` Apache-2.0 | Superhuman uses it. Combos + sequences. |

> **Repo note:** cmdk's canonical docs are **`cmdk.paco.me`**; the GitHub repo now redirects
> `pacocoursey/cmdk` → `github.com/dip/cmdk`. npm package is still `cmdk`. Cite the docs site.

**Division of labour:** cmdk/kbar render+rank the *menu*; tinykeys/react-hotkeys-hook/mousetrap bind the
*global shortcuts* (both the `⌘K` that opens it and per-action binds). cmdk docs are explicit: it does **not**
listen for ⌘K itself — you wire that so you control context.

---

## Recipe 1 — ⌘K dialog (the baseline)

```tsx
import { Command } from 'cmdk'
import * as React from 'react'

export function CommandMenu() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)          // same key opens AND closes
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command Menu">
      <Command.Input placeholder="Type a command or search…" />
      <Command.List>
        <Command.Empty>No results found.</Command.Empty>
        <Command.Group heading="Navigation">
          <Command.Item onSelect={() => go('/inbox')} keywords={['messages']}>
            Go to Inbox
          </Command.Item>
          <Command.Item onSelect={() => go('/settings')}>Open Settings</Command.Item>
        </Command.Group>
        <Command.Separator />
        <Command.Group heading="Actions">
          <Command.Item onSelect={createIssue}>Create issue…</Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
```
`Command.Dialog` composes Radix Dialog → focus trap + focus restoration + `Esc`-to-close for free. Every
`Command.Item` needs a **stable, unique** `value`/`key`. The ellipsis `…` signals "opens a submenu / needs
input."

## Recipe 2 — Nested commands with back-navigation (pages stack)

```tsx
const [pages, setPages] = React.useState<string[]>([])
const [search, setSearch] = React.useState('')
const page = pages[pages.length - 1]

<Command
  onKeyDown={(e) => {
    // Escape OR Backspace on an empty query → pop to previous page
    if (e.key === 'Escape' || (e.key === 'Backspace' && !search)) {
      e.preventDefault()
      setPages((p) => p.slice(0, -1))
    }
  }}
>
  <Command.Input value={search} onValueChange={setSearch} />
  <Command.List>
    {!page && (
      <Command.Item onSelect={() => setPages([...pages, 'theme'])}>Change theme…</Command.Item>
    )}
    {page === 'theme' && (
      <>
        <Command.Item onSelect={() => setTheme('dark')}>Dark</Command.Item>
        <Command.Item onSelect={() => setTheme('light')}>Light</Command.Item>
      </>
    )}
  </Command.List>
</Command>
```
**Flat-first, nested only for parametric actions** (anything needing a target: assignee, label, project,
theme value). Keep level-1 searchable across everything.

## Recipe 3 — Custom fuzzy filter (or bring your own results)

```tsx
import commandScore from 'command-score'

// Custom ranking (default already uses command-score; override to add weights/keywords logic):
<Command filter={(value, search, keywords) => commandScore(value, search, keywords)}>
```
```tsx
// Async / server-side results: turn off built-in filtering and drive the list yourself.
<Command shouldFilter={false}>
  <Command.Input value={q} onValueChange={setQ} />
  <Command.List>
    {loading && <Command.Loading>Fetching…</Command.Loading>}
    {results.map((r) => <Command.Item key={r.id} value={r.id} onSelect={() => open(r)}>{r.title}</Command.Item>)}
  </Command.List>
</Command>
```
**Ranking cheat sheet (command-score multipliers):** exact = 1; case-mismatch ×0.9999 (smart-case for free);
prefix ×0.99; word-jump ×~0.9 (`ln`→"Loch Ness"); char-jump ×~0.3 (`lch`→"loch"); transposition ×0.1
(`htlm`→"html"); long-jump ×0.01. Position & boundary beat raw character presence — never rank with plain
`includes()` at scale. For **fzf-style** (file paths, camelCase humps, separators) use an fzy/fzf scorer; for
**large content search with typo tolerance** use **Fuse.js**, not command-score.

## Recipe 4 — Contextual shortcut scoping (react-hotkeys-hook)

```tsx
import { useHotkeys } from 'react-hotkeys-hook'

// Global: works anywhere, including inputs → open help
useHotkeys('shift+/', () => setHelpOpen(true), { enableOnFormTags: true })   // "?"

// Contextual: single-key, must NOT fire while typing → archive current item
useHotkeys('e', archiveCurrent, { enableOnFormTags: false })                 // default: off in fields

// Sequence with tinykeys as an alternative: "g" then "i" → go to inbox
tinykeys(window, { 'g i': () => go('/inbox') })
```
**Reserve a tiny global set** (`⌘K`, `?`, `Esc`) that works everywhere; scope the rest so it's inert in text
fields.

## Recipe 5 — Platform-aware `<kbd>` shortcut display

```tsx
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

<Command.Item>
  Go to Inbox
  <span cmdk-shortcut=""><kbd>G</kbd> <kbd>I</kbd></span>
</Command.Item>
// Show `${mod}K` in the trigger hint. Never show Windows users ⌘; never show mac users "Ctrl".
```
Render shortcuts as real `<kbd>` (semantic, styleable, SR-sensible). Normalize glyphs per platform
(`⌘⌥⇧` on mac, `Ctrl/Alt/Shift` elsewhere).

## Recipe 6 — Screen-reader result-count announcements

```tsx
import { useCommandState } from 'cmdk'

function ResultCount() {
  const count = useCommandState((s) => s.filtered.count)
  return (
    <div aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
      {count === 0 ? 'No results' : `${count} result${count === 1 ? '' : 's'}`}
    </div>
  )
}
```
cmdk provides combobox roles + `aria-activedescendant` virtual focus; **you** provide the live region.

---

## Empty-state & discoverability patterns
- **Open to recents + suggestions**, not a blank list. Prioritize by **current view** (Linear: viewing cycles
  → cycle commands first). Rank recents by **frecency** (frequency × recency).
- **Pin** the user's top actions to the top.
- **"Did you mean" / create-fallback:** on no match, `forceMount` a `Create "<query>"` item; render
  `No results for "{search}"` using `useCommandState((s)=>s.search)`.
- **Persistent hint:** the trigger reads `Search…  ⌘K`; `?` opens a full command/shortcut reference.

## Command-vs-search-vs-universal-search (pick one, be explicit)
- **Linear pattern:** separate triggers — `⌘K` runs *commands*, a distinct trigger *searches content*.
- **Notion pattern:** one search box, filter results **by type** (page/person/database), deep-link to result.
- **Failure:** an ambiguous box where users can't predict whether typing runs an action or searches content.

## Accessibility contract (WAI-ARIA Combobox)
- Input `role="combobox"` + `aria-expanded` + `aria-controls`(→listbox id) + `aria-autocomplete="list"`;
  results `role="listbox"`, items `role="option"` + `aria-selected`.
- **DOM focus stays on input**; arrows move a *virtual* highlight via `aria-activedescendant`. **You must
  scroll the active option into view** (browsers don't auto-scroll it — critical for zoom users).
- Popup + descendants are **excluded from Tab order** (navigate with arrows). `Enter` selects; `Esc`
  clears/closes and does **not** commit until Enter (undo advantage).
- **Focus ring = real border, not transparency** (transparent borders vanish in Windows High Contrast); use
  `forced-color-adjust`/`currentcolor` on SVG glyphs.
- cmdk implements roles + focus management + is tested with VoiceOver; you own **live-region announcements**
  and **platform `<kbd>`**.

## Mobile / touch
Degrade, don't port. Search-first bottom sheet, big tap targets, no `⌘K` hint; recents/suggestions carry the
load (no fast typing to filter huge lists). Raycast: desktop-only. Linear: collapses to search.

## Top failure modes (checklist)
1. Undiscoverable palette (no ⌘K hint). 2. Undiscoverable actions (no `?` cheat sheet / no recents).
3. Single-key binds firing in text fields. 4. Fighting reserved browser/OS combos. 5. No SR result
announcements. 6. Single-key/SR quick-nav collisions. 7. Ambiguous command-vs-search box. 8. Weak ranking
(`includes()` over command-score). 9. No virtualization past ~2–3k items. 10. Focus lost on close.

## Copy guidance (charm)
Verb-first, scannable labels ("Assign to…", "Archive issue", "Switch theme"). `…` = opens submenu / needs
input. Help text < ~40 chars. Write `keywords` **synonyms** on every item so users find actions by intent
("Log out" ← `['sign out','logout']`), not exact wording.

## Verified facts (2026-07-01)
- cmdk `1.1.1` MIT; not virtualized (good to ~2–3k items); React 18+; **does not** auto-listen for ⌘K.
- command-score `0.1.2` MIT, 0 deps, by Superhuman; scoring multipliers above are from the package README.
- kbar `0.1.0-beta.48` MIT · tinykeys `4.0.0` MIT (~1 KB) · react-hotkeys-hook `5.3.3` MIT · mousetrap Apache-2.0.
- ⌘K convention (opens+closes on same key; restore prior focus; press-twice for conflicts): Superhuman eng blog.
- Grouping + contextual prioritization by current view + icons for discoverability: Linear changelog 2019-12-18.
- Combobox roles / `aria-activedescendant` self-managed scroll / Tab-exclusion / high-contrast border: W3C ARIA APG.
