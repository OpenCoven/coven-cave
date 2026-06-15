# Library link browser — design

**Date:** 2026-06-11
**Status:** Approved by Val (in-session)

## Goal

When a link item (bookmark or reading-list item) is selected in the library,
the middle preview pane shows the page itself in an embedded browser instead
of only a metadata card.

## Scope

- **In:** bookmarks and reading-list items whose `url` passes `isSafeHttpUrl`.
- **Out:** GitHub items (github.com sends `X-Frame-Options: deny`; the embed
  would always be blank — they keep the current metadata detail), docs,
  skills, projects, graph. No server-side proxying. No Tauri child-webview
  work in this iteration.

## Approach

Sandboxed `<iframe>` in the preview pane. Works the same in the web build and
the Tauri webview. Sites that refuse framing show the browser's own refusal
page (or nothing); a persistent toolbar keeps the escape hatch visible, so no
blocked-embed detection heuristics are needed or attempted.

## Components

### New: `src/components/library-link-browser.tsx`

```
Props: {
  url: string;          // already validated by caller
  title: string;        // item title for the toolbar
  details: ReactNode;   // existing detail card, shown on the Details tab
}
```

Layout, top to bottom:

1. **Toolbar** (slim, one row): item title (truncated), the URL (truncated,
   secondary text), a `Browser | Details` tab toggle, an Open button
   (existing `openUrl` helper — `shell_open` under Tauri, `window.open`
   otherwise), and Copy URL (existing `CopyButton`).
2. **Content area** (fills remaining height):
   - **Browser tab (default):** `<iframe src={url}
     sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
     referrerPolicy="no-referrer">`. A loading shimmer shows until the
     iframe `onLoad` fires. Behind the iframe, a dim watermark hint:
     "Some sites refuse to embed — use Open." (visible when the frame
     renders nothing).
   - **Details tab:** renders `details` unchanged.

Tab state is a local `useState` defaulting to Browser. The component is
mounted with `key={item.id}` so selecting a different item remounts it:
tab resets to Browser and the previous page is dropped.

### Changed: `src/components/library-doc-preview.tsx`

At the existing branch points for `selected.kind === "bookmark"` and
`"reading"`:

- If `item.url` is present and `isSafeHttpUrl(item.url)` → render
  `<LibraryLinkBrowser url title details={<BookmarkDetail …/>} key={item.id}/>`
  (resp. `ReadingDetail`).
- Exception: reading items with a local `.pdf` path keep the existing
  embedded `PdfViewer` (rendered inside `ReadingDetail`) — the link
  browser must not shadow it.
- Otherwise → render the detail card alone, exactly as today.

All other kinds are untouched.

### Styles

`src/styles/library.css` — toolbar row, tab toggle, iframe fill
(`width/height: 100%`, no border), watermark hint. Follow existing
`library-preview-*` class conventions. NOTE: `library.css` currently has
uncommitted edits from a concurrent session — additions must be appended
non-destructively and the file must not be reverted or reformatted.

## Security

- Only `http(s)` URLs that pass the existing `isSafeHttpUrl` reach the
  iframe; everything else falls back to the details card.
- `sandbox` without `allow-top-navigation`: framed pages cannot navigate
  the app away. Popups escape to the real browser via `allow-popups`.
- `referrerPolicy="no-referrer"` — don't leak the app origin to framed
  pages.

## Error handling

- Missing/unsafe URL: details card only (no iframe, no toolbar change).
- Blocked embed (`X-Frame-Options`/CSP): no detection; the watermark hint
  plus the always-visible Open button are the recovery path.
- Slow pages: shimmer until `onLoad`; no timeout logic.

## Testing

`src/components/library-link-browser.test.ts` — source-assertion style
(matches the repo's existing component tests):

- iframe carries the exact `sandbox` allowlist and `referrerPolicy`.
- `library-doc-preview.tsx` gates the browser behind `isSafeHttpUrl` for
  both bookmark and reading branches.
- Tab toggle markup present (Browser/Details).
- Component is keyed by item id at the call sites.

Wire the test into the `test:app` chain in `package.json` (project
convention: unwired tests rot silently).

## Out of scope / future

- Tauri child-webview rendering for sites that block framing.
- Per-item remembered tab choice.
- Navigation controls (back/forward/reload) inside the embed.
