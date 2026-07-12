import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./inspector-pane.tsx"), "utf8");
const chatSurface = readFileSync(resolve(here, "./chat-surface.tsx"), "utf8");

test("inspector sections are promoted to the chat right panel — no nested strip", () => {
  // The pane is a controlled section body: the chat right panel owns the
  // top-level tabs (Familiar / Analytics / Automations), so the old
  // tab-strip-inside-a-tab-strip is gone from the pane itself.
  assert.doesNotMatch(src, /ariaLabel="Inspector sections"/, "no nested section strip in the pane");
  assert.match(src, /tab\?: Tab/, "the pane takes its section as a controlled prop");
  assert.match(
    chatSurface,
    /INSPECTOR_SECTIONS[\s\S]{0,300}\{ id: "familiar", label: "Familiar" \},\s*\{ id: "analytics", label: "Analytics" \},\s*\{ id: "inbox", label: "Automations" \},/,
    "chat right panel declares the promoted section tabs",
  );
  assert.match(chatSurface, /<InspectorPane[\s\S]{0,400}tab=\{section\}/, "chat right panel drives the pane's section");
  // Debug is demoted to an icon toggle beside close, not a co-equal section.
  assert.match(chatSurface, /right-panel-tab--icon[\s\S]{0,300}ph:bug-bold/, "debug is an icon toggle");
});

test("inbox badge is softened from danger to warning tone", () => {
  assert.doesNotMatch(
    chatSurface,
    /bg-\[var\(--color-danger\)\] px-1 text-\[9px\] font-bold text-white/,
    "old red danger pill removed",
  );
  assert.match(
    chatSurface,
    /bg-\[color-mix\(in_oklch,var\(--color-warning\)_28%,transparent\)\]/,
    "warning-tinted soft badge present on the Automations tab",
  );
});

test("InspectorEmpty helper is defined and used for the three no-familiar/error states", () => {
  assert.match(src, /function InspectorEmpty\(/, "helper declared");
  const usages = src.match(/<InspectorEmpty\b/g) ?? [];
  assert.ok(usages.length >= 3, `expected >=3 usages, got ${usages.length}`);
  assert.match(src, /icon="ph:bell"\s+title="No familiar selected"/, "inbox empty state");
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

test("inbox card gets fired-state visual emphasis + hover affordance", () => {
  // Fired cards: warning-tinted border + bg
  assert.match(
    src,
    /border-\[color-mix\(in_oklch,var\(--color-warning\)_45%,var\(--border-hairline\)\)\]/,
    "fired card uses warning-tinted border",
  );
  // Default cards: hover state on bg-raised
  assert.match(src, /hover:bg-\[var\(--bg-raised\)\]\/70/, "default cards have hover state");
  // Cards have a stable class hook for tests/screenshot diffs
  assert.match(src, /inspector-inbox-card/, "stable class hook present");
});

test("inspector empty helper imports IconName for type-safe icon prop", () => {
  assert.match(src, /import \{ Icon, type IconName \} from "@\/lib\/icon"/, "IconName imported");
  assert.match(src, /icon: IconName;/, "InspectorEmpty.icon typed as IconName");
});

