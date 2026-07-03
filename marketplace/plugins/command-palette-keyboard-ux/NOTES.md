# NOTES — command-palette-keyboard-ux

The "why this exists / trade-offs / when NOT to use" appendix. Read alongside `SKILL.md`.

## Why this skill exists
Coding familiars (Cody, coven-code, cast-codes) repeatedly get asked to "add a ⌘K bar." The palette *UI*
is the easy 20%; the failure modes cluster in the other 80%: (1) **shortcut registration** that fires
inside text inputs, fights the browser, or collides with screen readers; (2) **accessibility** — a palette
that's a `<div>` soup instead of a combobox, with silent filtering SR users can't perceive; and (3)
**discoverability** — a palette nobody knows exists, with actions nobody can find and no way to list them.
This skill gives a decision tree + verified recipes so a familiar ships a *correct, accessible, discoverable*
palette on the first pass, not a pretty overlay that's a keyboard-and-a11y liability.

It **complements, not duplicates**, sibling marketplace plugins:
- `shadcn-ui-and-radix` — shadcn ships cmdk as `<Command>`; this skill is the deep dive on *using* it well
  (ranking, nesting, a11y, shortcuts) rather than the component-catalog overview.
- `wcag-a11y-audit` — general accessibility auditing; this skill is the *combobox-pattern-specific*
  implementation layer (aria-activedescendant, live-region counts, SR quick-nav collisions).
- `framer-motion-patterns` — motion/enter-exit for the overlay; this skill owns the *behaviour/ranking/
  keyboard* layer, not the animation.
- `charm` copy plugins — this skill defers command *labels/help-text/keyword synonyms* to charm and just
  states the conventions.

## The tool split people get wrong
The single most common conceptual error: treating "the command palette library" as one thing. It's **two
independent layers**:
- **Menu layer** (renders + ranks the list): `cmdk` (unstyled primitive) or `kbar` (batteries-included).
- **Keybinding layer** (binds the ⌘K that opens it *and* every per-action shortcut): `tinykeys` /
  `react-hotkeys-hook` / `mousetrap`.

`cmdk` **deliberately does not listen for ⌘K** — its docs say do it yourself for context control. So you
*always* pair cmdk with a keybinding lib (or hand-rolled listeners). `kbar` bundles both, which is why it's
the "just give me a working ⌘K" option — at the cost of being beta and opinionated.

## Repo/location context (important)
- cmdk canonical docs: **`cmdk.paco.me`**. The docs domain currently **307-redirects to
  `github.com/dip/cmdk`**, and **`pacocoursey/cmdk` 301-redirects to `dip/cmdk`** (repo moved orgs,
  verified 2026-07-01). The npm package is unchanged: **`cmdk`**, MIT. Cite the docs site and the npm
  package, not a hardcoded GitHub org path — a `pacocoursey/cmdk` link will still resolve today but is not
  the source of truth.
- **command-score is a Superhuman package** (`0.1.2`, published years ago, 0 deps). It's stable precisely
  because it's small and done — don't be alarmed by the "10 years ago" publish date; that's the algorithm
  cmdk still uses.

## Trade-offs & sharp edges
- **No built-in virtualization in cmdk.** Docs put the comfortable ceiling at **~2,000–3,000 items**. Past
  that you set `shouldFilter={false}` and bring react-virtual/react-window + your own filtering. Don't
  discover this at 10k items in production.
- **`aria-activedescendant` does NOT auto-scroll.** The browser won't scroll the virtually-focused option
  into view — you must do it manually. Skipping this silently breaks keyboard users at high zoom (they
  arrow "down" and the highlight leaves the viewport). This is an APG-documented responsibility, not a
  cmdk bug.
- **Single-key shortcuts vs screen readers.** JAWS/NVDA use single letters (`h`, `b`, `k`, `e`…) for
  browse-mode quick-nav. An app that binds bare `e`/`x`/`k` globally can either not fire (SR intercepts) or
  fire *and* stomp the SR user's navigation. Mitigation is doctrinal: **never** make a single-key bind the
  sole path; always give a palette entry + modifier equivalent. This is a correctness constraint, not a
  nice-to-have.
- **Press-once vs press-twice for conflicts.** The `Cmd+K` collision is real: in a rich-text editor `Cmd+K`
  conventionally means "insert link." Superhuman's resolution — first press = contextual action, second
  press = palette — is elegant but adds hidden state; document it or users think ⌘K is broken in the editor.
- **Command-vs-search ambiguity.** If one box both runs actions and searches content with no signal, users
  can't predict behaviour. Choose the **Linear split** (separate triggers) or **Notion type-filtered search**
  explicitly. "Everything in one fuzzy box" feels clever and tests badly.
- **Ranking with `includes()`.** cmdk's docs show a substring filter as the *simplest* custom example;
  people copy it and ship it. At any real scale it ranks "Chat" above "Change" for `ch`. Keep the default
  command-score, or use fzy for path-like data. Substring match is fine only for a handful of items.
- **Focus restoration.** `Command.Dialog` (Radix Dialog) restores focus to the trigger on close; a
  hand-rolled overlay must save/restore `document.activeElement` itself or focus falls to `<body>`.
- **Mobile.** The palette is a desktop-keyboard feature. Rendering `<kbd>⌘K</kbd>` to a phone user is a
  tell that the pattern was ported without thought. Degrade to search + native controls.

## When NOT to build a command palette
- **Touch-primary product** → search-first UI + native controls; don't port the overlay.
- **The palette would be the only way to reach an action** → it must sit *on top of* visible UI (also an
  a11y requirement). Buttons/menus still exist.
- **Fewer than ~a dozen total actions** → a visible menu/toolbar is more discoverable; a palette is
  overkill and just hides things.
- **Large content search with typo tolerance** → that's a search index / Fuse.js / server-side search
  problem; surface it *in* a palette if you like, but command-score is not a document search engine.

## Verification / testing checklist for a familiar
- [ ] `⌘K`/`Ctrl+K` toggles (same key opens AND closes); `Esc` closes; `?` opens a shortcut cheat sheet.
- [ ] Single-key/sequence binds are **inert in text fields** (test typing in every input).
- [ ] No reserved browser/OS combo hijacked (`⌘/Ctrl + W/T/N/L/Q/F/S`); press-twice used for `Cmd+K` in editors.
- [ ] Input is `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-autocomplete`; results are listbox/option.
- [ ] Arrowing moves `aria-activedescendant` **and scrolls the active option into view** (test at 200% zoom).
- [ ] `aria-live="polite"` region announces result count / "No results" (test with VoiceOver + NVDA).
- [ ] Focus ring uses a real border (test in Windows High Contrast / forced-colors).
- [ ] Focus is restored to the trigger on close.
- [ ] Empty query shows recents/suggestions (not blank); "Create '<query>'" or "did you mean" on no match.
- [ ] Shortcuts shown as platform-correct `<kbd>` (⌘ on mac, Ctrl on Win/Linux).
- [ ] Ranking uses command-score/fzy (not bare `includes()`); `keywords` synonyms on every action.
- [ ] > ~2–3k items → `shouldFilter={false}` + virtualization.
- [ ] Mobile degrades to search + native controls; no `⌘K` hint shown to touch users.

## Framework portability
The *pattern* is framework-agnostic; only the menu/keybinding libs change:
- **Vue:** no single canonical cmdk-equivalent — VueUse `useMagicKeys` for keybindings; community command-
  palette components or Headless UI Combobox for the menu. The ARIA combobox contract, ranking choices,
  shortcut philosophy, and mobile degradation in this skill apply verbatim.
- **Svelte:** `svelte-command-palette` / bits-ui command component; keybindings via `svelte-hotkeys` or
  manual. Same principles.
- **Native/desktop:** Raycast/Alfred are the platform-native realization; the launcher lineage (Quicksilver
  → Alfred) and frecency ranking predate the web pattern and inform it.
- **Fuzzy ranking** ports everywhere: `command-score` (JS), `fzy`/`fzf` (Go/C), `fuzzaldrin` (editors),
  `Fuse.js` (content search) — pick by whether you're ranking a **bounded action list** (command-score/fzy)
  or **large content** (Fuse/index).

## Primary sources
All URLs in `plugin.json` `x-coven.sourceRefs` were fetched/verified on 2026-07-01 (cmdk docs API + FAQ,
command-score README multipliers, W3C ARIA APG combobox pattern + example, Linear changelog, Superhuman eng
blog, tinykeys/react-hotkeys-hook READMEs, fzf ADVANCED.md). Library versions/licenses confirmed against the
npm registry. Full annotated source list with what each confirms lives in
`research/synthesis/2026-07-01-command-palette-keyboard-ux.md`.
