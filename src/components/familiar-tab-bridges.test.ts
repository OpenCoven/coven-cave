// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab bridges + ergonomics (cave-aovo, redesigned by the design
// handoff into the header's pill row). The tab must not dead-end: from the
// header you can reach the familiar's memory, its Studio editor, its profile
// card / analytics (pinned in familiar-tab-hero.test.ts), and start a fresh
// chat. Touch targets grow on coarse pointers, and the pane is a labelled
// landmark.

const src = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab.css", import.meta.url), "utf8");

test("memory bridge: the sibling pane's content is reachable via the Studio memory tab", () => {
  assert.match(
    src,
    /import \{ openFamiliarStudioSettingsTab \} from "@\/lib\/familiar-studio-context"/,
    "uses the shared Studio redirect helper",
  );
  assert.match(
    src,
    /onClick=\{\(\) => openFamiliarStudioSettingsTab\("memory", familiar\.id\)\}[\s\S]{0,300}?>\s*Memory\s*</,
    "Memory pill opens the Studio memory tab for this familiar",
  );
});

test("studio bridge: Edit in Studio preselects this familiar's identity tab", () => {
  assert.match(
    src,
    /onClick=\{\(\) => openFamiliarStudioSettingsTab\("identity", familiar\.id\)\}[\s\S]{0,300}?>\s*Edit in Studio\s*</,
    "Edit in Studio pill opens the Studio identity tab",
  );
});

test("new chat is the header's primary action — the one filled-accent control", () => {
  assert.match(src, /onStartChat\?: \(familiarId: string\) => void/, "typed callback seam");
  assert.match(
    src,
    /onClick=\{\(\) => onStartChat\(familiar\.id\)\}[\s\S]{0,400}?bg-\[var\(--accent-presence\)\][\s\S]{0,200}?text-\[var\(--accent-presence-foreground\)\]/,
    "filled accent + readable accent foreground (token pair, not hard-coded white)",
  );
  assert.match(src, /\{onStartChat \? \(/, "the button only renders when the host provides the seam");
  // The chat surface wires the seam: activate the familiar, flip to the
  // conversation tab, then open a fresh session for it.
  assert.match(
    chatSurface,
    /function startFamiliarHeroChat\(familiarId: string\) \{[\s\S]*?onSetActiveFamiliar\(familiarId\);[\s\S]*?setScope\("conversation"\);[\s\S]*?newChat\(undefined, undefined, familiarId\)/,
    "chat surface lands the hero action on a fresh conversation",
  );
});

test("the tab and the memory rail are separately labelled landmarks", () => {
  assert.match(
    src,
    /className="chat-familiar-view[\s\S]{0,200}?aria-label="Familiar profile"/,
    "the tab owns its own labelled landmark",
  );
  const pane = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");
  assert.match(pane, /aria-label="Familiar memory"/, "the memory rail keeps its own label");
});

test("voice bridge: a configured speaking voice is shown and opens the Studio Brain tab", () => {
  assert.match(
    src,
    /getVoiceProvider\(familiar\.voiceProvider\)\?\.label \?\? familiar\.voiceProvider/,
    "provider labels come from the canonical voice registry (no second mapping)",
  );
  assert.match(
    src,
    /const voiceLine = familiar\.voiceProvider\s*\?/,
    "silent familiars add no voice noise — the line renders only when a provider is bound",
  );
  assert.match(
    src,
    /onClick=\{\(\) => openFamiliarStudioSettingsTab\("brain", familiar\.id\)\}[\s\S]{0,500}?\{voiceLine\}/,
    "the voice line bridges to the Studio Brain tab, voice's managed home",
  );
  assert.match(
    src,
    /aria-label=\{`Voice settings for \$\{resolved\?\.display_name \?\? familiar\.display_name\}/,
    "the voice bridge announces the same resolved name the heading shows",
  );
});

test("coarse pointers get honest touch targets without changing pointer-fine rhythm", () => {
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]{0,600}?\.familiar-tab__links a,\s*\.familiar-tab__links button \{[^}]*min-height: 32px/, "header pills grow");
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]{0,900}?\.familiar-tab__group-toggle,\s*\.familiar-tab__row-toggle \{[^}]*padding-block/, "group and role toggles grow");
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]{0,1200}?\.familiar-tab__cta \{[^}]*padding-block/, "teach CTAs grow");
  assert.match(src, /className="familiar-tab__links mt-2/, "header pill row carries the coarse-pointer hook");
});
