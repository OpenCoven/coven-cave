// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./youtube-viewer.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// The JS-API params are added only on the live iframe (withJsApi), never baked
// into the logical src returned by parseYoutubeEmbed.
assert.match(view, /function withJsApi\(/, "JS-API params live in a separate wrapper");
assert.match(view, /src=\{withJsApi\(src\)\}/, "the iframe src is wrapped, the logical src stays clean");

// ── Player API wiring (needed for title + volume in the mini bar) ────────────
assert.match(view, /enablejsapi/, "iframe opts into the YouTube IFrame API");
assert.match(view, /new YT\.Player\(/, "a YT.Player attaches to the live iframe");
assert.match(view, /getVideoData\(\)/, "reads the real video title for the mini bar");
assert.match(view, /\.setVolume\(/, "drives volume through the player");
assert.match(view, /\.nextVideo\(\)/, "mini bar can skip to the next track");

// ── Collapse state ───────────────────────────────────────────────────────────
assert.match(view, /data-collapsed=\{collapsed \? "true" : undefined\}/, "root exposes the collapsed state to CSS");
assert.match(view, /cave:youtube:collapsed/, "collapse choice persists across reloads");
assert.match(view, /youtube-viewer__mini/, "renders the mini now-playing bar");

// The iframe must NOT remount on collapse (audio would stop) — collapse is a
// pure state flip, and the iframe key tracks only the source.
assert.match(view, /key=\{src\}/, "iframe is keyed on src only (collapse never remounts it)");

// ── CSS: collapsed pane shrinks to the mini bar; iframe stays a live sliver ──
assert.match(
  css,
  /\.youtube-viewer\[data-collapsed="true"\] \.youtube-viewer__frame \{[\s\S]*?flex: 0 0 1px[\s\S]*?opacity: 0/,
  "collapsed: the iframe is slivered (kept playing), not unmounted",
);
assert.match(
  css,
  /\.youtube-viewer\[data-collapsed="true"\] \.youtube-viewer__mini \{[\s\S]*?display: flex/,
  "collapsed: the mini now-playing bar is shown",
);
assert.match(
  css,
  /\.companion-rail__split:has\(\.youtube-viewer\[data-collapsed="true"\]\) #companion-rail-youtube \{[\s\S]*?flex: 0 0 40px !important/,
  "collapsed: the bottom pane parks at the mini-bar height so the top pane reclaims the space",
);

// ── Now-playing polish: primary play disc + an animated equalizer ────────────
assert.match(
  view,
  /youtube-viewer__mini-btn--primary/,
  "the mini bar's play/pause reads as the primary control",
);
assert.match(view, /<Equalizer playing=\{playing\}/, "the mini bar shows a now-playing equalizer");
assert.match(
  css,
  /\.youtube-viewer__eq\[data-playing="true"\] i \{[\s\S]*?animation: youtube-eq/,
  "the equalizer animates while playing",
);

console.log("youtube-collapse.test.ts: ok");
