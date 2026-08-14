// @ts-nocheck
// Source pins for the new-session inline composer (Chat.dc.html 2b).
//
// The mock draws the brief directly under the hero and has no dock at all.
// Cave's composer is permanently docked, so the temptation is to build a
// SECOND composer in the page. That would fork the draft, the project / model
// / branch selection and the enhance flow, and put two textareas on screen.
// These pins exist so that shortcut stays closed: one composer element, two
// positions, chosen by whether the chat has a session yet.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./chat-new-dashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/home-dashboard.css", import.meta.url), "utf8");

test("one composer element, rendered in exactly one of two positions", () => {
  assert.match(chatView, /const composerNode = \(/, "the dock is extracted to a variable, not duplicated");
  assert.match(chatView, /const inlineComposer = sessionId === null;/, "inline only on a brand-new chat");
  assert.match(
    chatView,
    /\{inlineComposer \? null : composerNode\}/,
    "the docked position yields when the composer goes inline",
  );
  assert.match(chatView, /composer=\{composerNode\}/, "the same node is handed to the dashboard");
  // Exactly one <footer className="cave-composer-dock"> in the tree.
  assert.equal(
    (chatView.match(/className="cave-composer-dock"/g) ?? []).length,
    1,
    "a second dock element would mean two composers",
  );
});

test("the dashboard places the composer between hero and bands", () => {
  assert.match(dashboard, /composer\?: ReactNode;/, "the slot is typed");
  // The slot now also carries 2b's trailing row ("Save as default" + the start
  // hint), so this matches the guard and the wrapper rather than a one-liner.
  assert.match(
    dashboard,
    /\{composer \? \(\s*<div className="home-dash__composer">\s*\{composer\}/,
    "the slot renders only when handed a composer",
  );
  assert.match(dashboard, /: null\}/, "and renders nothing when it is not");
  const hero = dashboard.indexOf("home-dash__headline");
  const slot = dashboard.indexOf("home-dash__composer");
  const bands = dashboard.indexOf("<ChatStartFromBands");
  assert.ok(hero > 0 && slot > 0 && bands > 0, "all three landmarks present");
  assert.ok(hero < slot && slot < bands, "order is hero -> composer -> bands (2b)");
});

test("the dashboard never builds its own composer", () => {
  for (const forbidden of ["<textarea", "usePromptEnhance", "ComposerContextChips", "EnhanceStrip"]) {
    assert.ok(
      !dashboard.includes(forbidden),
      `the dashboard must not rebuild composer internals (${forbidden}) — it receives ChatView's`,
    );
  }
});

test("the inline composer stays selectable inside a select-none root", () => {
  // ChatNewDashboard's root carries `select-none`; the composer is now nested
  // inside it, so `user-select: none` inherits onto the textarea. Chromium
  // still allows keyboard select-all, so a functional probe passes — what
  // breaks is mouse drag-selection under WebKit, which is the desktop shell.
  assert.match(dashboard, /home-dash__body home-dash--embed select-none/, "the root really is select-none");
  const rule = css.match(/\.home-dash__composer \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(rule, /user-select: text/, "selection is handed back to the composer");
  assert.match(rule, /-webkit-user-select: text/, "including the WebKit prefix — the desktop shell is WKWebView");
});

test("inline styling only undoes dock chrome", () => {
  const rule = css.match(/\.home-dash__composer \.cave-composer-dock \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(rule, "the inline override exists");
  for (const prop of ["padding: 0", "border-top: 0", "background: none"]) {
    assert.ok(rule.includes(prop), `inline composer resets ${prop}`);
  }
  // The docked gradient/hairline read as a pinned band; nothing else should be
  // restyled, or the two positions start drifting apart visually.
  assert.doesNotMatch(rule, /position:|display:|width:/, "placement is layout's job, not this override's");
});
