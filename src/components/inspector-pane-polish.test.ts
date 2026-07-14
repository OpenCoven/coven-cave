import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./inspector-pane.tsx"), "utf8");
const chatSurface = readFileSync(resolve(here, "./chat-surface.tsx"), "utf8");

test("the pane is a controlled section body — memory + familiar only", () => {
  // The inspector sidepanel is retired. The pane renders the one section its
  // host drives: the chat surface's Familiar tab or the companion rail's
  // Memory tab. Analytics/Automations are gone with the panel.
  assert.doesNotMatch(src, /ariaLabel="Inspector sections"/, "no nested section strip in the pane");
  assert.match(src, /tab\?: Tab/, "the pane takes its section as a controlled prop");
  assert.match(src, /export type Tab = "memory" \| "familiar"/, "analytics/inbox sections are retired");
  assert.doesNotMatch(src, /FamiliarAnalyticsView|InboxTab|SnoozeMenu/, "no analytics or automations rendering remains");
  assert.match(
    chatSurface,
    /<InspectorPane familiar=\{activeFamiliar\} tab="familiar" daemonRunning=\{daemonRunning\} onStartChat=\{startFamiliarHeroChat\} \/>/,
    "the chat surface's Familiar tab drives the pane's familiar section (presence threaded)",
  );
  assert.doesNotMatch(chatSurface, /INSPECTOR_SECTIONS/, "the promoted right-panel section strip is gone");
});

test("InspectorEmpty helper is defined and used for the no-familiar/error states", () => {
  assert.match(src, /function InspectorEmpty\(/, "helper declared");
  const usages = src.match(/<InspectorEmpty\b/g) ?? [];
  assert.ok(usages.length >= 2, `expected >=2 usages, got ${usages.length}`);
  assert.match(src, /icon="ph:sparkle"\s+title="No familiar selected"/, "familiar empty state");
  assert.match(src, /icon="ph:warning"\s+title="Memory unavailable"/, "memory error state");
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

