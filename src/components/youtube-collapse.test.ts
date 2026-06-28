// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./youtube-viewer.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// The embedded YouTube surface must not use a DOM iframe or the YouTube IFrame
// Player API. In desktop Tauri it requests a native child webview; in plain dev
// browser mode it renders a non-interactive frame that keeps the same footprint.
assert.doesNotMatch(view, /<iframe\b/, "YouTube viewer should not render a DOM iframe");
assert.doesNotMatch(view, /youtube\.com\/iframe_api|YT\.Player|enablejsapi/, "YouTube iframe API should not be loaded");
assert.match(view, /browser_navigate/, "YouTube viewer should request a native child webview when available");
assert.match(view, /youtube-viewer__native-frame/, "renders a native-frame placeholder for webview bounds");
assert.match(view, /youtube-viewer__dev-frame/, "renders the dev-only non-interactive frame fallback");

// ── Collapse state ───────────────────────────────────────────────────────────
assert.match(view, /data-collapsed=\{collapsed \? "true" : undefined\}/, "root exposes the collapsed state to CSS");
assert.match(view, /cave:youtube:collapsed/, "collapse choice persists across reloads");
assert.match(view, /youtube-viewer__mini/, "renders the mini now-playing bar");

// No playback controls: this is an embedded web frame, not a custom player.
assert.doesNotMatch(view, /playVideo|pauseVideo|nextVideo|setVolume|type="range"/, "no custom player controls");

// ── CSS: collapsed pane shrinks to the mini bar; native frame is hidden ──────
assert.match(
  css,
  /\.youtube-viewer\[data-collapsed="true"\] \.youtube-viewer__frame \{[\s\S]*?flex: 0 0 1px[\s\S]*?opacity: 0/,
  "collapsed: the frame is parked as a hidden sliver",
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

// ── Now-playing polish: static indicator + an animated-ready equalizer ───────
assert.doesNotMatch(view, /youtube-viewer__mini-btn--primary/, "mini bar has no primary playback control");
assert.match(view, /<Equalizer playing=\{playing\}/, "the mini bar shows a now-playing equalizer");
assert.match(
  css,
  /\.youtube-viewer__eq\[data-playing="true"\] i \{[\s\S]*?animation: youtube-eq/,
  "the equalizer animates while playing",
);

console.log("youtube-collapse.test.ts: ok");
