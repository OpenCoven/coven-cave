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

// ── Two rows: media (headlines) is split out onto its own track, away from the
//    chats track (needs-you + summary + sessions + suggestions).
assert.match(view, /home-digest__track--media/, "media headlines render on their own separate track");
assert.match(view, /c\.kind !== "rss"/, "chats row = every non-rss card (needs + summary + sessions + suggestions)");
assert.match(view, /c\.kind === "rss"/, "media row = the rss headline cards");

// ── News is opt-out in Settings → General — no inline dismiss on the row ──────
assert.match(view, /const newsEnabled = useHomeNewsEnabled\(\)/, "news visibility comes from the persistent user setting");
assert.match(view, /mediaCards\.length > 0 && newsEnabled/, "disabling news leaves the chat digest row intact");
assert.doesNotMatch(view, /mediaDismissed|setMediaDismissed/, "the per-mount dismissed state is retired (setting is the one source of truth)");
assert.doesNotMatch(view, /aria-label="Close news carousel"/, "the inline X close button is removed");
assert.doesNotMatch(view, /home-digest__media-close/, "no close-button markup remains");
// cave-e2zx: the lane chrome is gone entirely — no icon marker, no band. The
// track's aria-label is the lane's only (accessible) name; the reversed drift
// direction separates it visually from the chats row.
assert.doesNotMatch(view, /home-digest__media-chrome/, "the icon-only lane chrome stays deleted");
assert.doesNotMatch(view, /home-digest__media-label/, "no lane-marker markup remains");
assert.match(
  view,
  /home-digest__track home-digest__track--media" aria-label="Media headlines"/,
  "the media track still names the lane for AT",
);
assert.doesNotMatch(view, />News</, "the visible 'News' word is removed from the media lane chrome");

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
assert.doesNotMatch(css, /home-digest__media-chrome/, "dead lane-chrome CSS is removed with the marker");
assert.doesNotMatch(css, /home-digest__media-close/, "dead close-button CSS is removed with the inline dismiss");

// ── Settings owns the opt-out: General section renders the switch ─────────────
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
assert.match(settings, /import \{ useHomeNewsEnabled, writeHomeNewsEnabled \} from "@\/lib\/home-news-pref"/, "settings imports the shared news pref");
assert.match(
  settings,
  /label="News headlines"[\s\S]*?role="switch"[\s\S]*?aria-checked=\{newsEnabled\}[\s\S]*?writeHomeNewsEnabled\(!newsEnabled\)/,
  "General settings exposes the News headlines switch backed by the pref",
);

// ── Hidden from the default home (chat revamp 1a) — component retained ────────
// The carousel no longer renders on the home surface: its signal folds into
// the hearth card's Continue + Open work sections. The component file (and
// its behavior pins above) survive for any future surface that mounts it.
assert.doesNotMatch(composer, /<HomeDigestCarousel/, "home no longer renders the carousel");
assert.doesNotMatch(composer, /import \{ HomeDigestCarousel \}/, "home no longer imports the carousel");

// ── Ambient refresh pauses during composition (sits right below the composer) ──
assert.match(
  view,
  /usePausablePoll\(\(\) => \{ void loadDigest\(\); \}, 60_000, \{ pauseWhileInputActive: true \}\)/,
  "the once-a-minute digest refresh pauses while the user is typing",
);

// ── Live presence tier (cave-9j6a): running sessions read from Home ──────────
assert.match(view, /card\.kind === "live"/, "the carousel renders the live-card branch");
assert.match(
  view,
  /className="home-digest__card home-digest__card--live"/,
  "live cards wear the presence variant",
);
assert.match(view, /home-digest__live-dot/, "live cards carry the breathing status dot");
assert.match(
  view,
  /home-digest__card--live"[\s\S]{0,800}Running now/,
  "clicking a live card opens the session; AT hears 'Running now'",
);
assert.match(css, /\.home-digest__card--live \{/, "live variant styled from presence tokens");
assert.match(
  css,
  /home-digest-live-pulse/,
  "the dot pulse is a named keyframe (token durations zero it under reduced motion)",
);

console.log("home-digest-carousel.test.ts passed");
