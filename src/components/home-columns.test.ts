// @ts-nocheck
// Home two-column footer: static Continue/News lists replace the marquee
// carousel — resume affordance on the newest session, display-boundary title
// cleaning, no auto-scroll animation left anywhere on Home.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const cont = await readFile(new URL("./home/home-continue-column.tsx", import.meta.url), "utf8");
const news = await readFile(new URL("./home/home-news-column.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

// Composer renders the columns, not the carousel.
assert.match(composer, /<HomeContinueColumn/, "composer renders the Continue column");
assert.match(composer, /<HomeNewsColumn/, "composer renders the News column");
assert.doesNotMatch(composer, /HomeDigestCarousel/, "digest carousel is gone from Home");

// Continue column: display-boundary title cleaning + resume-first row.
assert.match(cont, /sessionDisplayTitle/, "titles go through the session-title cleaner");
assert.match(cont, /home-col-card--primary/, "newest session gets the prominent resume card");
assert.match(cont, /archived_at/, "archived sessions are excluded");
assert.match(cont, /onOpenSession\?\.\(s\.id, s\.familiarId \?\? null\)/, "cards resume via onOpenSession");

// News column reuses the pure digest builder (filtering/thumbnails/ages).
assert.match(news, /buildDigestCards\(\{ items: \[\], sessions: \[\], rssItems: rss, nowMs \}\)/,
  "news reuses buildDigestCards with empty inbox/sessions");
assert.match(news, /openExternalUrl/, "headlines open externally");

// News stays opt-out via Settings → General (carried over from the carousel).
assert.match(news, /const newsEnabled = useHomeNewsEnabled\(\)/,
  "news visibility comes from the persistent user setting");
assert.match(news, /!newsEnabled \|\| !ready \|\| cards\.length === 0/,
  "disabling news hides the column");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
assert.match(settings, /import \{ useHomeNewsEnabled, writeHomeNewsEnabled \} from "@\/lib\/home-news-pref"/,
  "settings imports the shared news pref");
assert.match(
  settings,
  /label="News headlines"[\s\S]*?role="switch"[\s\S]*?aria-checked=\{newsEnabled\}[\s\S]*?writeHomeNewsEnabled\(!newsEnabled\)/,
  "General settings exposes the News headlines switch backed by the pref",
);

// The marquee is fully retired.
assert.doesNotMatch(css, /home-digest/, "digest CSS removed");
assert.doesNotMatch(css, /marquee/, "marquee animation removed");
assert.match(css, /\.home-columns\s*\{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(0, 1fr\)\)/, "two-column grid");
assert.match(css, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.home-columns\s*\{[\s\S]*?grid-template-columns: 1fr/,
  "columns stack on narrow viewports");

// Resume affordance on the newest session is always visible — never a
// hover-only reveal, so it reads on touch devices too.
assert.match(cont, /home-col-card__go/, "primary card carries a visible Resume affordance");

// The home entrance choreography and ambient halo motion are opt-in on
// prefers-reduced-motion: no-preference (reduced motion gets a static page).
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?animation: home-rise/,
  "entrance choreography is gated on no-preference");
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?animation: home-halo-breathe/,
  "halo breathing is gated on no-preference");

console.log("home-columns.test.ts: ok");
