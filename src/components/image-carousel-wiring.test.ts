// @ts-nocheck
// Wiring pins: the chat transcript must mount ONE carousel per `<coven:image>`
// deck, strip the markers while streaming, and route multi-image attachments
// through the same component (cave-djuvt).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const carousel = readFileSync(new URL("./image-carousel.tsx", import.meta.url), "utf8");
const attachmentCards = readFileSync(new URL("./chat-attachment-cards.tsx", import.meta.url), "utf8");

// ── chat-view: imports and render paths ─────────────────────────────────────
assert.match(
  chatView,
  /import \{ imageCarouselKey, sliceImageBlocks, stripImageMarkers \} from "@\/lib\/image-blocks"/,
  "chat-view imports the image-blocks lib",
);
assert.match(
  chatView,
  /import \{ ImageCarousel \} from "@\/components\/image-carousel"/,
  "chat-view imports ImageCarousel",
);
assert.match(chatView, /function splitSegmentsForImages\(/, "has the segments→image splitter");
assert.match(chatView, /function splitSegmentsForArtifacts\(/, "has a segment-preserving artifact splitter");
assert.match(chatView, /<ImageCarousel images=\{p\.carousel\.images\} \/>/, "mounts the carousel as a block segment");
assert.match(
  chatView,
  /splitSegmentsForGitHub\(\s*splitSegmentsForArtifacts\(splitSegmentsForImages\(\[\{ kind: "text", text: visibleWithGh \}\]\), artifactCtx\)/,
  "settled path splits images before GitHub/artifact cards, so one group deck can span either boundary",
);
// Marker pipeline (cave-zs85n): skill -> auto-status -> attention -> next-path
// extraction all see the marker-bearing text before image/GitHub stripping
// runs, and that strip is unconditional and LAST — so raw image tags never
// flash on a pending OR a settled turn.
assert.match(
  chatView,
  /const \{ visible: visibleWithGh, suggestions: nextPaths \} = extractNextPaths\(attentionSplit\.visible\)/,
  "next-path extraction (fed by attention, fed by auto-status, fed by skill) runs before image/GitHub markers are stripped",
);
assert.match(
  chatView,
  /const visible = stripImageMarkers\(stripGitHubMarkers\(visibleWithGh\)\)/,
  "image markers strip unconditionally and LAST, after skill/auto-status/attention/next-path extraction — raw tags never flash on pending OR settled turns",
);
assert.doesNotMatch(
  chatView,
  /turn\.pending\s*\?\s*stripImageMarkers\(stripGitHubMarkers\(/,
  "image stripping must not be gated behind turn.pending — it runs unconditionally on both streaming and settled turns",
);
assert.match(
  chatView,
  /out\.push\(pieces\[0\]\.text === seg\.text \? seg : \{ \.\.\.seg, text: pieces\[0\]\.text \}\)/,
  "the settled segmented path retains image-block cleanup instead of restoring an incomplete raw marker",
);

// ── the card: a11y + packaged-app image loading ─────────────────────────────
assert.match(carousel, /AuthedImage/, "pictures load through AuthedImage (packaged sidecar auth gate)");
assert.match(carousel, /usePrefersReducedMotion/, "the slide track has a reduced-motion story");
assert.match(
  carousel,
  /reducedMotion \? "" : "transition-all duration-\[var\(--duration-fast\)\]"/,
  "dot width changes do not animate when reduced motion is requested",
);
assert.match(carousel, /useFocusTrap\(true, dialogRef/, "the lightbox traps focus and returns it on dismiss");
assert.match(
  carousel,
  /<AuthedImage\s+src=\{image\.src\}[\s\S]*?fallback=\{/,
  "the lightbox preserves an image-load fallback instead of opening an empty dialog",
);
assert.match(carousel, /aria-roledescription=\{multiple \? "carousel" : undefined\}/, "a multi-image deck announces itself as a carousel");
assert.match(carousel, /aria-live="polite"/, "slide changes are announced");
assert.match(carousel, /aria-label="Previous image"/, "prev control is named");
assert.match(carousel, /aria-label="Next image"/, "next control is named");
assert.match(carousel, /focus-ring/, "interactive elements carry the focus ring");
assert.match(carousel, /bg-\[var\(--backdrop-scrim\)\]/, "the lightbox overlay uses the shared backdrop token");
assert.match(
  carousel,
  /tabIndex=\{i === safeIndex \? 0 : -1\}/,
  "Tab must not walk through slides nobody can see",
);
assert.match(
  carousel,
  /slideRefs\.current\[nextIndex\]\?\.focus\(\)/,
  "arrow navigation moves focus onto the newly visible slide instead of hiding it on the prior slide",
);
assert.match(
  carousel,
  /ArrowRight/,
  "arrow keys move the deck",
);
assert.match(
  carousel,
  /if \(total === 0\) return null;/,
  "an empty deck renders nothing rather than an empty frame",
);
assert.ok(
  !/useAnnouncer\(/.test(carousel),
  "the card uses a LOCAL live region — the app announcer hook throws outside its provider, and this card mounts anywhere",
);

// ── attachments reuse the same deck ─────────────────────────────────────────
assert.match(
  attachmentCards,
  /import \{ ImageCarousel \} from "@\/components\/image-carousel"/,
  "attachment cards import the shared carousel",
);
assert.match(
  attachmentCards,
  /if \(images\.length > 1\) \{[\s\S]*?<ImageCarousel/,
  "two or more image attachments render as ONE carousel, not a ragged wrap",
);

console.log("image-carousel-wiring: all assertions passed");
