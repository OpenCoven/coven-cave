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

test("chat-surface tab strip uses the shared Vercel-style Tabs component", () => {
  const src = read("./chat-surface.tsx");
  // Tab visuals + ARIA now come from the shared component.
  assert.match(src, /import \{ Tabs \} from "@\/components\/ui\/tabs"/, "imports shared Tabs");
  assert.match(src, /<Tabs<FamiliarsScope>/, "renders shared Tabs for the scope strip");
});

test("shared Tabs component renders ARIA roles and the rounded 2px underline", () => {
  const src = read("./ui/tabs.tsx");
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

test("chat-view new-chat start screen uses a polished launch layout", () => {
  const src = read("./chat-view.tsx");
  assert.match(src, /className="cave-chat-empty-shell"/, "empty state has a constrained launch shell");
  assert.match(src, /className="cave-chat-empty-familiar"/, "agent identity is grouped in a dedicated row");
  assert.match(src, /className="cave-chat-empty-project"/, "project picker uses the launch-screen project treatment");
  assert.match(src, /className="cave-chat-empty-prompts"/, "starter prompts render in a targetable responsive grid");
  assert.match(src, /className="cave-chat-empty-prompt"/, "starter prompts use the polished prompt button class");
  assert.doesNotMatch(src, /Runs on|type\s*\{" "\}|to reference files/, "empty state should not show verbose feature-instruction copy");
});

test("cave-chat.css modernizes the new-chat launch surface responsively", () => {
  const src = read("../styles/cave-chat.css");
  assert.match(
    src,
    /\.cave-chat-empty-shell\s*\{[\s\S]*?width:\s*min\(680px,\s*100%\);[\s\S]*?display:\s*grid;/,
    "launch shell is constrained and grid-based",
  );
  assert.match(
    src,
    /\.cave-chat-empty-prompts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    "starter prompts use a balanced two-column grid on desktop",
  );
  assert.match(
    src,
    /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.cave-chat-empty-prompts\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    "starter prompts collapse to one column on narrow screens",
  );
});

test("cave-chat.css hides the kb hint on coarse pointers", () => {
  const src = read("../styles/cave-chat.css");
  assert.match(
    src,
    /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.cave-chat-empty-hint\s*\{[\s\S]*?display:\s*none/,
    "coarse-pointer rule hides .cave-chat-empty-hint",
  );
});
