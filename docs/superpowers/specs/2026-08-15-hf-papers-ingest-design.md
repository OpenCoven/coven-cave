# Research Desk: Hugging Face paper ingest with an embedded PDF viewer

**Bead:** `cave-cbz28` · **Date:** 2026-08-15 · **Status:** approved, not yet implemented

## Problem

Research Desk resources are saved links. `src/lib/server/research-links.ts` stores them,
`src/lib/link-organizer.ts` categorizes and titles them. A `paper` category already
exists, but `PAPER_HOSTS` covers arxiv.org, doi.org, openreview.net and friends — not
`huggingface.co`. Pasting a Hugging Face paper today lands as an `other` link with a
title derived from the URL slug.

Two gaps follow from that:

1. **`hf papers read 2401.12345` is invisible to ingest.** It contains no URL, so
   `extractLinks` finds nothing and the paste is silently dropped.
2. **There is no PDF viewer anywhere in the app.** The only `.pdf` references are
   incidental, in `chat-view.tsx` and `citations.ts`. Opening a paper resource means
   leaving Cave.

## Goal

Pasting any of these into the Research Desk resource ingest saves **one** paper resource
carrying a real title, authors and abstract — and opening it renders the PDF inline:

```
hf papers read 2401.12345
hf paper read 2401.12345
https://huggingface.co/papers/2401.12345
https://arxiv.org/abs/2401.12345
https://arxiv.org/pdf/2401.12345
```

## Verified constraints

Probed live on 2026-08-15:

| URL | Result |
| --- | --- |
| `arxiv.org/pdf/<id>` | `content-type: application/pdf`, no `X-Frame-Options` |
| `huggingface.co/papers/<id>` | `X-Frame-Options: DENY` |
| `huggingface.co/api/papers/<id>` | JSON: `id`, `title`, `authors[].name`, `publishedAt`, `summary` |

The first two settled which URL the document comes from: the HF page cannot be shown
in-app under any approach, so the PDF is fetched from arXiv and the HF page is a link out.

Note the framing headers stop mattering once §7 chooses pdf.js — we render the bytes
ourselves rather than embedding a document. The proxy in §5 is retained for three
different reasons: it makes the fetch same-origin so CORS never enters the picture, it
keeps the local-only guard consistent with sibling routes, and it avoids third-party
fetch behaviour differing under WKWebView.

## Design

### 1. Pattern parsing — `src/lib/hf-papers.ts` (new, pure)

```ts
export function parseHfPaperReferences(text: string): string[]  // canonical arXiv ids
export function hfPaperUrl(arxivId: string): string             // canonical resource URL
```

arXiv id shape is `\d{4}\.\d{4,5}(v\d+)?`. Every recognised spelling canonicalizes to
`https://huggingface.co/papers/<id>`, so the existing normalized-URL dedupe in
`saveResearchLinks` collapses all five inputs above into one resource.

**A bare `2401.12345` with no command or URL around it is deliberately not matched.**
Pasted prose is full of decimal numbers and version strings; matching them would
manufacture resources nobody asked for. The command prefix or a URL is the signal.

### 2. Ingest wiring

`link-organizer.ts` categorizes by host, but `huggingface.co` also serves models,
datasets, spaces and blog posts. Adding the host to `PAPER_HOSTS` would mislabel all of
them. Instead a **path-aware rule** runs before the host check: `huggingface.co/papers/*`
→ `paper`; every other path on that host keeps today's behaviour.

`POST /api/research/links` already extracts URLs from pasted `text`. It additionally runs
`parseHfPaperReferences` over the same text, because the `hf papers read <id>` form
contains no URL at all. Extracted URLs and parsed paper ids merge before the existing
`MAX_LINKS_PER_SAVE` cap and dedupe.

### 3. Metadata — `src/lib/server/hf-paper-metadata.ts` (new)

`fetchHfPaperMetadata(arxivId)` calls `https://huggingface.co/api/papers/<id>` with a
**5-second timeout** and maps to `{ title, authors, abstract, publishedAt }`. Ingest is
an interactive paste, so the budget is set by how long a person will wait for the paste
to land, not by how long HF might take.

**Failure degrades, it does not fail the save.** A network hiccup or an id HF does not
know leaves the resource with today's derived title. Ingest that hard-fails on a flaky
third party is worse than ingest that stores a plain title.

### 4. Storage

`SavedLink` is `{ id, url, category, title, addedAt, source }`. It gains one optional
field:

```ts
paper?: { arxivId: string; authors: string[]; abstract: string; publishedAt: string };
```

`normalizeStoredLink` already re-derives `category` and `addedAt` rather than trusting
user-editable disk contents. The `paper` block gets the same treatment: validated on
read, dropped whole if malformed. No migration — the field is optional and absent on
every existing record.

### 5. PDF proxy — `src/app/api/research/papers/pdf/route.ts` (new)

`GET ?id=<arxivId>` streams `arxiv.org/pdf/<id>` as `application/pdf` with `Range`
passthrough, mirroring the streaming shape of the existing
`/api/research/generations/media` route.

Two guards:

- `rejectNonLocalRequest`, as every sibling route does.
- The id is validated against the strict regex and interpolated into a **hard-coded**
  arXiv URL. It never composes a host, a scheme or a path prefix, so there is no SSRF
  surface.

Same-origin proxying also keeps the viewer working under WKWebView, where third-party
fetch and PDF handling behave less predictably than in headless Chromium.

### 6. Viewer — `src/components/research-paper-viewer.tsx` (new)

**Opened from the resource itself.** A saved link in the `paper` category that carries a
`paper.arxivId` renders with a "Read" affordance alongside its existing open-in-browser
action; that affordance opens this viewer. Paper resources without `paper.arxivId` — an
arXiv or DOI link saved before this change, or one whose metadata fetch degraded — keep
today's behaviour exactly and show no Read affordance, because there is no id to stream.

Follows `chat-artifact-viewer.tsx` for structure and dismissal. Header carries title,
authors and publication date; the abstract sits above the document. Actions link out to
the HF page and arXiv, plus download.

Loading, error and retry states are modelled on `useResearchMediaUrl` — that is the
established shape here for "resolve, then render", and reusing it means the failure
affordances already match the rest of the surface.

Component chrome uses design tokens and primitives. `pnpm lint` runs
`codemod:design:check` over `src/components/**`, so raw colour and spacing values fail
the build.

### 7. Rendering — pdf.js

The document is rendered with **pdf.js** (`pdfjs-dist`) rather than a native `<iframe>`,
for text selection, in-document search, and page navigation. The proxy route from §5 is
still what serves the bytes; pdf.js fetches it same-origin.

Four integration constraints, each of which has a specific answer:

**Worker.** pdf.js runs its parser in a Web Worker, and **this would be the first Web
Worker in the codebase** — `src/` contains no `new Worker`, no `workerSrc`, no
`*.worker.*` today. The worker asset (`pdf.worker.min.mjs`) is copied from `pdfjs-dist`
into `public/` by a `postinstall` step and referenced as
`GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"`. Copying to `public/` rather than
bundling via `new Worker(new URL(…))` keeps it independent of Turbopack's worker
handling and keeps the asset available to the packaged desktop shell, which serves the
same static tree.

**Client-only.** pdf.js touches `DOMMatrix`, `Path2D` and canvas, none of which exist
during SSR. The viewer is loaded with `next/dynamic` and `ssr: false`.

**Bundle cost.** `pdfjs-dist` is large. Because the viewer is dynamically imported and
only on opening a paper, it stays out of the main bundle — nobody who never opens a paper
pays for it. `Frontend bundle` in CI is the check that would catch a regression here.

**Exact version.** `scripts/dependency-policy.test.mjs` asserts every entry in every
dependency block matches `^\d+\.\d+\.\d+…$`, so `pdfjs-dist` is pinned exactly, with no
caret.

Rendering itself: a canvas per page plus pdf.js's text layer over it, which is what makes
selection and search work. Page navigation and a zoom control sit in the viewer chrome.
Rendering is cancellable, so dismissing the viewer mid-render does not leave a detached
worker task writing to a canvas that is gone.

## Testing

Unit:

- the parser across the full pattern matrix, **including near-misses** — bare ids,
  `2401.1234567`, `v2` suffixes, ids embedded in prose
- the `huggingface.co/papers` path rule, asserting `huggingface.co/models/...` and
  `/blog/...` are unaffected
- metadata mapping and its degradation path
- PDF route: id validation, non-local rejection, `Range` passthrough
- the dependency-policy test already covers the exact-version pin; no new unit test needed
  for that

**pdf.js rendering is not unit-testable here.** The runner is `node --test`, which has no
canvas, no `DOMMatrix` and no worker. Asserting that pages actually render belongs in
Playwright, against real Chromium. What the unit layer *can* own is the pure part: the
id → proxy-URL mapping, and the viewer's state machine (idle → loading → ready → error,
and cancellation on dismiss) with the pdf.js module injected as a dependency.

End-to-end: a daemon-less Playwright spec that dismisses onboarding
(`cave:onboarding:dismissed=1`) and **`page.route`-mocks both new endpoints**. The PDF
route is fulfilled with a **committed single-page fixture PDF**, not a stub body — pdf.js
parses what it is given, so a fake payload fails at the parser and proves nothing. The
assertions are that the page canvas renders, that the text layer carries the fixture's
known text, and that search finds it. A fixture of a few kilobytes is enough.

That last point is not boilerplate. On 2026-08-14, PR #4634 added
`/api/research/generations/media-ticket` and made the media player conditional on it, but
did not mock the endpoint in `tests/research-studio-media.spec.ts`. The player element
stopped rendering, two specs failed, and `main` was red for hours — blocking every PR
touching `src/**`, since those classify `e2e: true`. See `cave-1kv8i`. This design adds a
route and a conditional viewer, which is exactly the same shape, so the spec mocks ship
with the feature.

## Out of scope

- Chat slash-command ingest. The paste box plus URL recognition covers the request; a
  composer command is a separate surface with its own parsing and registry.
- Page thumbnails and an outline/bookmarks sidebar. pdf.js exposes both, but they are
  additional chrome on top of a reader that already selects, searches and navigates.
- Annotation, highlighting or note-taking on the document.
- The full HF payload (upvotes, linked models and datasets). More schema and more to keep
  in sync with an API we do not control.
