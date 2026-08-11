# Chat image carousel — design

Bead: `cave-djuvt`. Companion to
[`chat-github-integration.md`](chat-github-integration.md), whose §1 marker
protocol this reuses wholesale.

## Mission

Make pictures in chat feel like one deliberate object rather than a wall of
`![](…)`. A familiar that wants to show three screenshots should get one
browsable carousel, and it should not have to invent the presentation.

## Decisions

- **One component, every producer.** `src/components/image-carousel.tsx` is
  the only way chat shows pictures. Familiar markers, `/image` generations,
  and a user's pasted screenshots all land in the same deck.
- **Markers, not markdown.** Markdown image syntax stays plain markdown;
  a deliberate `<coven:image …>` marker is what mounts a carousel. That keeps
  incidental links from hijacking the transcript.
- **Merge is the default.** Adjacent markers collapse into one deck, so the
  natural way to emit three images already produces the right card.

## §1 Marker protocol (`src/lib/image-blocks.ts`)

```text
<coven:image src="https://…/a.png" alt="Home, dark" caption="Before" />
<coven:image src="/api/chat/attachment?id=…" alt="Home, light" caption="After" />
```

- **Attributes** — `src` (required), `alt`, `caption`, `group`.
- **Merging** — two markers join one deck when they are separated by nothing
  but whitespace, or when they share a `group="…"` id. Group wins over
  adjacency, and a grouped deck mounts at its first marker's position, so a
  familiar can interleave prose and still land every shot in one carousel.
- **Fenced markers stay literal** — example text is never a live card, the
  same contract `coven:github` and `coven:skill` hold.
- **Streaming** — complete markers and an unterminated tail are stripped while
  the turn streams, so a raw tag never flashes. Cards mount on settle.
- **Malformed markers are dropped silently** — never rendered as raw tags.
- **Cap** — `MAX_CAROUSEL_IMAGES` (24) per deck; extras are dropped.

### `src` is a security barrier

Marker text is model output, so an unvalidated `src` is a script-execution and
local-file-read surface. `isRenderableImageSrc` accepts only:

| Form | Why |
| --- | --- |
| `https://…` | remote pictures, unless the path enters `/api/` |
| `data:image/{png,jpeg,jpg,gif,webp,avif};base64,…` | inline payloads |
| `blob:…` | in-process object URLs |
| `/api/chat/attachment` (same origin) | the read-only attachment store |

Everything else is refused, explicitly including `javascript:`, `vbscript:`,
`file:`, bare `http:`, protocol-relative `//host/…`, `data:image/svg+xml`
(an SVG can carry script) and any value containing control characters.

The `/api/` exclusion applies to the absolute spelling too: `https://<origin>/api/…`
is refused just as `/api/…` is, because `needsAuthedImageFetch` turns any
same-origin `/api/*` into an authenticated GET, and a marker that could name one
would otherwise reach it by writing the URL out in full.

## §2 The card (`src/components/image-carousel.tsx`)

- One image renders bounded with no chrome; controls appear only at two or
  more, so a single picture never grows a carousel's furniture.
- Prev/next buttons, a dot strip, an `n / total` counter, and Arrow keys while
  focus is inside the deck.
- Clicking a slide opens a focus-trapped lightbox (Escape closes, focus
  returns to the trigger) with the same arrow-key navigation.
- Pictures load through `AuthedImage`, so the one permitted
  `/api/chat/attachment` source survives the packaged sidecar's auth gate (see
  `src/lib/authed-image.ts`).
- The slide track animates only when the user has not asked for reduced
  motion; under `reduce` the change is instant.
- Slide changes announce through a **local** live region — the card mounts in
  places the app announcer provider does not reach.
- Only the visible slide is tab-reachable; hidden slides are `aria-hidden`.

## §3 Familiar awareness

`buildCovenMarkersDirective()` (`src/lib/coven-marker-directive.ts`) teaches
the marker on every chat turn, beside the GitHub, skill, and auto-status
protocols. `coven-marker-directive.test.ts` parses the directive's own example
back through `sliceImageBlocks`, so drifted syntax fails there before a
familiar ever emits an unparseable marker.

## §4 Testing

| File | Pins |
| --- | --- |
| `src/lib/image-blocks.test.ts` | src allow-list, merging, fences, streaming strip, cap |
| `src/components/image-carousel-wiring.test.ts` | transcript wiring, a11y contracts, attachment reuse |
| `src/lib/coven-marker-directive.test.ts` | the taught example parses |
