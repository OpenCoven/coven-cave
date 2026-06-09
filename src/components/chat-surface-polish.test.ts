import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

test("chat-router renders mobile-aware empty-state copy", () => {
  const src = read("./chat-router.tsx");
  assert.match(src, /useIsMobile/, "imports useIsMobile");
  assert.match(src, /Choose a familiar to start chatting/, "mobile heading present");
  assert.match(src, /Choose a familiar from the sidebar selector/, "desktop heading present");
  assert.match(src, /Open the menu to pick a familiar/, "mobile subline present");
  assert.match(src, /Pick who should handle the conversation from the left panel/, "desktop subline present");
});

test("companion-rail accepts suppressEmpty and short-circuits", () => {
  const src = read("./companion-rail.tsx");
  assert.match(src, /suppressEmpty\?:\s*boolean/, "suppressEmpty prop typed");
  assert.match(src, /suppressEmpty\s*=\s*false/, "default value declared");
  assert.match(src, /if\s*\(suppressEmpty\)\s*return null/, "early return when suppressed");
});

test("workspace passes suppressEmpty={mode === 'chat'} to CompanionRail", () => {
  const src = read("./workspace.tsx");
  assert.match(src, /suppressEmpty=\{mode === "chat"\}/, "suppressEmpty wired for chat mode");
});

test("chat-surface tab strip uses ARIA roles and the rounded underline", () => {
  const src = read("./chat-surface.tsx");
  assert.match(src, /role="tablist"/, "tablist role present");
  assert.match(src, /role="tab"/, "tab role present");
  assert.match(src, /aria-selected=\{isActive\}/, "aria-selected wired");
  assert.match(src, /after:h-\[2px\]/, "2px underline pseudo-element present");
  assert.match(src, /after:rounded-full/, "rounded underline present");
});

test("chat-view empty state hint is tagged for touch-device hiding", () => {
  const src = read("./chat-view.tsx");
  assert.match(src, /cave-chat-empty-hint/, "hint class applied to {modKey}↵ paragraph");
});

test("cave-chat.css hides the kb hint on coarse pointers", () => {
  const src = read("../styles/cave-chat.css");
  assert.match(
    src,
    /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.cave-chat-empty-hint\s*\{[\s\S]*?display:\s*none/,
    "coarse-pointer rule hides .cave-chat-empty-hint",
  );
});
