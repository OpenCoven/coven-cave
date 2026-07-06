// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./home/home-digest-carousel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");
const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");

// ── Data sources: assembled client-side from existing endpoints (no new route)
assert.match(view, /\/api\/inbox/, "pulls today's activity from /api/inbox");
assert.match(view, /\/api\/rss/, "pulls headlines from /api/rss");
assert.match(view, /buildDigestCards/, "delegates ordering to the pure builder");

// ── Click behavior: rss opens externally, sessions resume in-app ──────────────
assert.match(view, /openExternalUrl\(card\.url\)/, "rss cards open the link externally");
assert.match(view, /onOpenSession\?\.\(card\.sessionId/, "session cards resume the chat");

// ── Seamless marquee: a duplicated, a11y-hidden second row ─────────────────────
assert.match(view, /duplicate/, "renders a duplicate row so the loop is seamless");
assert.match(view, /aria-hidden=\{duplicate/, "the duplicate row is hidden from assistive tech");
assert.match(view, /tabIndex={tabIndex}/, "duplicated cards are removed from the tab order");

// ── Empty/loading: nothing renders until ready, and nothing when no cards ──────
assert.match(view, /if \(!ready \|\| cards\.length === 0\) return null/, "hidden until there's something to show");

// ── Two rows: media (headlines) is split out onto its own track, away from chats
assert.match(view, /home-digest__track--media/, "media headlines render on their own separate track");
assert.match(view, /c\.kind === "summary" \|\| c\.kind === "session"/, "chats row = summary + session cards");
assert.match(view, /c\.kind === "rss"/, "media row = the rss headline cards");

// ── News carousel can be dismissed only from its explicit close affordance ────
assert.match(view, /const \[mediaDismissed, setMediaDismissed\] = useState\(false\)/, "tracks dismissed state for the news/media carousel");
assert.match(view, /mediaCards\.length > 0 && !mediaDismissed/, "dismissing media leaves the chat digest row intact");
assert.match(view, /aria-label="Close news carousel"/, "news carousel exposes an accessible close button");
assert.match(view, /onClick=\{\(\) => setMediaDismissed\(true\)\}/, "close button hides the news carousel");
assert.doesNotMatch(view, /onMouseEnter=\{\(\) => setMediaDismissed\(true\)\}/, "hovering the close affordance must not hide the news carousel");
assert.match(view, /home-digest__media-close/, "close button has a stable styling hook");

// ── Media cards support an image thumbnail (with icon fallback on error) ───────
assert.match(view, /home-digest__thumb/, "media card renders an image thumbnail when available");
assert.match(view, /card\.image/, "media thumbnail is sourced from the card's image field");
assert.match(view, /onError=\{\(\) => setImgError\(true\)\}/, "thumbnail falls back to the icon on load error");

// ── CSS: the marquee, the subtle hover pause, and reduced-motion fallback ──────
assert.match(css, /@keyframes home-digest-marquee/, "defines the marquee animation");
assert.match(css, /translateX\(-50%\)/, "loops at -50% to pair with the duplicated row");
assert.match(
  css,
  /\.home-digest:hover \.home-digest__track[\s\S]*?animation-play-state: paused/,
  "auto-scroll pauses on hover",
);
assert.match(css, /focus-within \.home-digest__track/, "also pauses when a card is focused");
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/,
  "reduced-motion disables the auto-scroll",
);
assert.match(
  css,
  /@media[^{]*\((?:hover: none|pointer: coarse)\)[\s\S]*?overflow-x: auto/,
  "touch/coarse-pointer devices fall back to manual horizontal scroll (no hover to pause)",
);
assert.match(css, /mask-image: linear-gradient\(to right/, "soft fade edges on the strip");
assert.match(css, /home-digest-marquee 100s/, "marquee slowed to 100s for readability");
assert.match(css, /\.home-digest__track--media[\s\S]*?animation-direction: reverse/, "media row drifts the opposite way, separated from chats");
assert.match(css, /\.home-digest__thumb[\s\S]*?object-fit: cover/, "media thumbnail is a cover-fit image");
assert.match(css, /\.home-digest__thumb[\s\S]*?width: 46px/, "media thumbnail is enlarged for the image-forward row");
assert.match(css, /\.home-digest__card--media[\s\S]*?padding-left/, "media cards are image-forward (thumbnail hugs the leading edge)");
assert.match(css, /\.home-digest__media[\s\S]*?position: relative/, "media row anchors the close button");
assert.match(css, /\.home-digest__media-close[\s\S]*?position: absolute[\s\S]*?top: 0[\s\S]*?right: 0/, "news close button sits at the media row's top-right corner");
assert.match(css, /\.home-digest__media-close\s*\{[^}]*pointer-events: auto/, "news close button is always directly clickable");
assert.doesNotMatch(css, /\.home-digest__media-close\s*\{[^}]*opacity: 0/, "news close button must not be hidden behind hover-only reveal");

// ── Wired into the home composer below "Jump back in" ─────────────────────────
assert.match(composer, /import \{ HomeDigestCarousel \}/, "home composer imports the carousel");
assert.match(composer, /<HomeDigestCarousel/, "home composer renders the carousel");

// ── Ambient refresh pauses during composition (sits right below the composer) ──
assert.match(
  view,
  /usePausablePoll\(\(\) => \{ void loadDigest\(\); \}, 60_000, \{ pauseWhileInputActive: true \}\)/,
  "the once-a-minute digest refresh pauses while the user is typing",
);

console.log("home-digest-carousel.test.ts passed");
