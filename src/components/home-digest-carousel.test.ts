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
assert.match(css, /mask-image: linear-gradient\(to right/, "soft fade edges on the strip");

// ── Wired into the home composer below "Jump back in" ─────────────────────────
assert.match(composer, /import \{ HomeDigestCarousel \}/, "home composer imports the carousel");
assert.match(composer, /<HomeDigestCarousel/, "home composer renders the carousel");

console.log("home-digest-carousel.test.ts passed");
