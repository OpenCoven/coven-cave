import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./inspector-pane.tsx"), "utf8");
const chatSurface = readFileSync(resolve(here, "./chat-surface.tsx"), "utf8");

test("the pane is memory-only — the familiar section moved to its own surface", () => {
  // The inspector sidepanel is retired and the chat Familiar tab is a
  // purpose-built surface (chat-familiar-view.tsx) — the pane renders the
  // memory rail alone. Analytics/Automations are gone with the panel.
  assert.doesNotMatch(src, /ariaLabel="Inspector sections"/, "no nested section strip in the pane");
  assert.doesNotMatch(src, /export type Tab\b/, "the controlled section prop is retired with the familiar section");
  assert.doesNotMatch(src, /FamiliarIdentityHero|FamiliarCapabilityPanel/, "no familiar-tab rendering remains in the pane");
  assert.doesNotMatch(src, /FamiliarAnalyticsView|InboxTab|SnoozeMenu/, "no analytics or automations rendering remains");
  assert.match(
    chatSurface,
    /<ChatFamiliarView[\s\S]*?familiar=\{activeFamiliar\}[\s\S]*?daemonRunning=\{daemonRunning\}[\s\S]*?onStartChat=\{startFamiliarHeroChat\}/,
    "the chat surface's Familiar tab mounts the purpose-built view (presence threaded)",
  );
  assert.doesNotMatch(chatSurface, /INSPECTOR_SECTIONS/, "the promoted right-panel section strip is gone");
});

test("InspectorEmpty helper is defined and used for the memory error state", () => {
  assert.match(src, /function InspectorEmpty\(/, "helper declared");
  const usages = src.match(/<InspectorEmpty\b/g) ?? [];
  assert.ok(usages.length >= 1, `expected >=1 usage, got ${usages.length}`);
  assert.match(src, /icon="ph:warning"\s+title="Memory unavailable"/, "memory error state");
  // The familiar lifecycle states live with the familiar surface now; a null
  // active familiar is no longer treated as a no-selection state.
  const familiarView = readFileSync(resolve(here, "./chat-familiar-view.tsx"), "utf8");
  assert.match(familiarView, /deriveFamiliarTabState/, "familiar state contract lives with the tab");
  assert.doesNotMatch(familiarView, /No familiar selected/, "all and multi scopes cannot regress to the singular empty state");
});

test("memory inner mode toggle uses the shared Vercel-style Tabs (2px underline)", () => {
  // The memory mode strip now delegates to the shared <Tabs> component, which
  // owns the tablist role + 2px underline idiom.
  assert.match(src, /<Tabs<"coven" \| "files">/, "memory mode renders shared Tabs");
  assert.match(src, /ariaLabel="Memory mode"/, "memory mode tablist labelled");
  // Should no longer use the old pill background for active mode
  assert.doesNotMatch(
    src,
    /mode === m\s*\n[\s\S]*?bg-\[color-mix\(in_oklch,var\(--accent-presence\)_15%,transparent\)\]/,
    "old pill background removed",
  );
});

test("Memory tab renders an 'Open full memory' footer when onOpenFullView is provided", () => {
  // The rail's brain (Memory) tab threads onOpenFullView so it can jump to the
  // full Agent Memory view, reusing the pinned .rail-memory__open-full button.
  assert.match(src, /onOpenFullView\?: \(\) => void/, "MemoryTab/InspectorPane accept onOpenFullView");
  assert.match(src, /onOpenFullView \? \(/, "footer button is conditional on the callback");
  assert.match(src, /rail-memory__open-full[\s\S]*?Open full memory/, "renders the Open full memory button");
});

test("inspector empty helper imports IconName for type-safe icon prop", () => {
  assert.match(src, /import \{ Icon, type IconName \} from "@\/lib\/icon"/, "IconName imported");
  assert.match(src, /icon: IconName;/, "InspectorEmpty.icon typed as IconName");
});
