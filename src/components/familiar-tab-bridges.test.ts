// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab bridges + ergonomics (cave-aovo → cave-moig skills-page
// handoff). The tab must not dead-end: memory is a first-class section tab,
// the Studio editor is one click away, a fresh chat starts from the hero, and
// the voice binding is editable in place. Touch targets grow on coarse
// pointers, and the pane is a labelled landmark.

const src = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab.css", import.meta.url), "utf8");

test("memory bridge: the familiar's memory is a first-class section, not a redirect", () => {
  assert.match(src, /\{ id: "memory", label: "Memory" \}/, "Memory is one of the five section tabs");
  assert.ok(src.includes("<FamiliarMemorySection familiar={familiar} />"), "the memory section mounts in place");
});

test("studio bridge: Edit in Studio preselects this familiar's identity tab", () => {
  assert.match(
    src,
    /import \{ openFamiliarStudioSettingsTab \} from "@\/lib\/familiar-studio-context"/,
    "uses the shared Studio redirect helper",
  );
  assert.match(
    src,
    /onClick=\{\(\) => openFamiliarStudioSettingsTab\("identity", familiar\.id\)\}[\s\S]{0,300}?>\s*Edit in Studio\s*</,
    "Edit in Studio opens the Studio identity tab",
  );
});

test("new chat is the header's primary action — the one filled-accent control", () => {
  assert.match(src, /onStartChat\?: \(familiarId: string\) => void/, "typed callback seam");
  assert.match(
    src,
    /variant="primary"[\s\S]{0,120}?leadingIcon="ph:plus"[\s\S]{0,120}?onClick=\{\(\) => onStartChat\(familiar\.id\)\}/,
    "New chat is the primary Button (the shared component owns the accent pair)",
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

test("voice bridge: the binding is editable in place, from the canonical registry", () => {
  assert.match(
    src,
    /import \{ listVoiceProviders \} from "@\/lib\/voice\/registry"/,
    "provider options come from the canonical voice registry (no second mapping)",
  );
  assert.match(
    src,
    /\{ value: "", label: "No voice", detail: "Silent familiar" \}/,
    "silence is an explicit, honest option",
  );
  assert.match(
    src,
    /onChange=\{\(v\) => void bind\(\{ voiceProvider: v \}\)\}/,
    "picking a provider writes the live binding",
  );
  assert.match(
    src,
    /detail: p\.id === voiceValue \? "Bound voice — tune in Studio" : undefined/,
    "the bound provider points at the Studio for fine-tuning",
  );
});

test("coarse pointers get honest touch targets without changing pointer-fine rhythm", () => {
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]{0,600}?\.familiar-tab__group-toggle,\s*\.familiar-tab__row-toggle \{[^}]*padding-block/, "group and role toggles grow");
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]{0,900}?\.familiar-tab__cta \{[^}]*padding-block/, "teach CTAs grow");
  // The retired hero pill row must not leave dead selectors behind.
  assert.doesNotMatch(css, /familiar-tab__links|familiar-tab__link-pill|familiar-tab__pill \{/, "no orphaned pill-row styles");
});
