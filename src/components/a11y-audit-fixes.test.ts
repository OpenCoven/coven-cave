import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (name: string) => readFile(new URL(name, import.meta.url), "utf8");

test("browser tabs are a tablist exposing name + selected state", async () => {
  const src = await read("./browser-pane.tsx");
  assert.match(src, /aria-label=\{tabTitles\[tab\.id\] \?\? tab\.title \?\? tab\.url\}/);
  assert.match(src, /role="tablist" aria-orientation="vertical"/);
  assert.match(src, /role="tab"/);
  assert.match(src, /aria-selected=\{isActive\}/);
});

test("calendar urgency dots carry a text alternative", async () => {
  const view = await read("./calendar-view.tsx");
  const primitives = await read("./calendar-view-primitives.tsx");
  assert.match(primitives, /function urgencyLabel\(item: InboxItem\): string/);
  assert.match(view, /role="img" aria-label=\{urgencyLabel\(item\)\}/);
  assert.match(view, /role="img" aria-label=\{urgencyLabel\(ev\.item\)\}/);
});

test("shell exposes a skip-to-content link targeting the main landmark", async () => {
  const shell = await read("./shell.tsx");
  assert.match(shell, /<a className="skip-link" href="#shell-main-content">Skip to main content<\/a>/);
  assert.match(shell, /<main className="shell-detail" id="shell-main-content" tabIndex=\{-1\}/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.skip-link\s*\{[\s\S]*?position:\s*absolute/);
  // The link must reveal itself on focus, not stay permanently off-screen.
  assert.match(css, /\.skip-link:focus[\s\S]*?transform:\s*translateY\(0\)/);
});

test("nav count badge uses a solid accent fill (WCAG contrast)", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // A 60%-alpha accent over the dark app background composited to ~1:1 against
  // the paired foreground; the fill must be solid so the count stays legible.
  assert.match(
    css,
    /\.menu-bar__badge\s*\{[\s\S]*?color:\s*var\(--accent-presence-foreground\)[\s\S]*?background:\s*var\(--accent-presence\);/,
  );
  assert.doesNotMatch(
    css,
    /\.menu-bar__badge\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 60%, transparent\)/,
  );
});

test("filled action buttons pair the fill with its semantic foreground", async () => {
  // White / --text-primary on --accent-presence failed AA (~2.8:1 dark), so
  // filled buttons must route to the fill's paired foreground token, which
  // adapts per mode. The Tasks redesign makes New task a --primary CTA (Coven
  // design language: accent is presence, not the CTA colour) — --primary-
  // foreground is its designed contrast pair, so the AA guarantee is preserved.
  const board = await readFile(new URL("../styles/board.css", import.meta.url), "utf8");
  assert.match(
    board,
    /\.board-new-card-btn\s*\{[^}]*background:var\(--primary\)[^}]*color:var\(--primary-foreground\)/,
  );
  assert.doesNotMatch(
    board,
    /\.board-new-card-btn\s*\{[^}]*color:var\(--text-primary\)/,
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Both salem accent action states use the paired foreground, not hardcoded #fff.
  assert.doesNotMatch(
    css,
    /\.salem-pf__action--primary\s*\{[^}]*background:\s*var\(--accent-presence\)[^}]*color:\s*#fff/,
  );
  assert.match(
    css,
    /\.salem-pf__action--primary\s*\{[^}]*color:\s*var\(--accent-presence-foreground\)/,
  );
});

test("priority pills darken their text in light mode (WCAG contrast)", async () => {
  const board = await readFile(new URL("../styles/board.css", import.meta.url), "utf8");
  // The pill text is lightened toward white for dark mode; light mode needs the
  // opposite (mix toward black) or it fails AA on the faint tint (~2:1).
  for (const variant of ["urgent", "high", "medium"]) {
    assert.match(
      board,
      new RegExp(`\\[data-mode="light"\\] \\.board-kanban-priority-pill--${variant}\\s*\\{[^}]*color:color-mix\\(in oklch,var\\(--[a-z-]+\\) 76%,black\\)`),
      `kanban ${variant} pill must darken text in light mode`,
    );
  }
  for (const variant of ["urgent", "high"]) {
    assert.match(
      board,
      new RegExp(`\\[data-mode="light"\\] \\.board-card-stack__priority-pill--${variant}\\s*\\{[^}]*black`),
      `card-stack ${variant} pill must darken text in light mode`,
    );
  }
});

test("bulk-select checkmark glyphs pair with the accent's semantic foreground", async () => {
  // The check sits on a filled var(--accent-presence) box; white failed the 3:1
  // non-text-contrast threshold in dark mode. Route to the paired foreground.
  const dashboard = await readFile(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  assert.match(
    dashboard,
    /\.dash-inbox__check\[data-checked="true"\]\s*\{[^}]*color:\s*var\(--accent-presence-foreground\)/,
  );
  assert.doesNotMatch(dashboard, /\.dash-inbox__check\[data-checked="true"\]\s*\{[^}]*color:\s*#fff/);
});

test("table lightbox traps Tab and restores focus to its trigger (CHAT-D11-02)", async () => {
  // openTableLightbox is imperative DOM — it can't mount useFocusTrap, so it
  // must hand-mirror the hook's contract. Without this, Escape/Close drops
  // keyboard focus to <body> and Tab walks the page behind the dialog.
  const src = await read("./message-dom-wiring.ts");
  const fn = src.slice(src.indexOf("function openTableLightbox"));
  assert.match(fn, /const returnFocus = document\.activeElement instanceof HTMLElement \? document\.activeElement : null;/);
  assert.match(fn, /returnFocus\?\.focus\(\);/, "dismiss must restore focus to the Expand trigger");
  assert.match(fn, /event\.key !== "Tab"/, "keydown handler must intercept Tab");
  assert.match(fn, /querySelectorAll<HTMLElement>\(FOCUSABLE\)/, "trap must cycle the shared FOCUSABLE set");
  assert.match(fn, /\(event\.shiftKey \? last : first\)\.focus\(\);/, "escaped focus must be recaptured into the dialog");
  assert.match(src, /import \{ FOCUSABLE \} from "@\/lib\/use-focus-trap";/);
});

test("backdrop matchAccent switch carries its own accessible name (cave-rc09)", async () => {
  // Wrapping a button in a <label> does not name it per HTML-AAM — without an
  // aria-label, screen readers announce only "On"/"Off". Same fix as the
  // Look-tab familiar switch in #3421 (1ac9d1ce).
  const src = await read("./backdrop-settings.tsx");
  assert.match(
    src,
    /role="switch"\s*aria-checked=\{prefs\.matchAccent\}\s*aria-label="Match accent to the image"/,
    "the matchAccent switch must carry an explicit aria-label",
  );
});
