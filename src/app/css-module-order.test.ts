// @ts-nocheck
import assert from "node:assert/strict";
import path from "node:path";
import cssContract from "../../scripts/css-source-contract.cjs";

const { readRawCssSync, readEffectiveCssSync } = cssContract;

const FACADES: Record<string, string[]> = {
  "src/app/globals.css": [
    "../styles/sidebar-minimal.css",
    "../styles/status-bar.css",
    "../styles/globals/foundations.css",
    "../styles/globals/shell-navigation.css",
    "../styles/globals/primitives.css",
    "../styles/globals/themes.css",
    "../styles/globals/desktop-chrome.css",
    "../styles/globals/shell-responsive.css",
    "../styles/globals/calendar-agenda.css",
    "../styles/globals/surface-compact-calendar.css",
    "../styles/globals/surface-reporting.css",
    "../styles/globals/surface-chat-overlays.css",
    "../styles/globals/surface-marketplace.css",
    "../styles/globals/surface-role-workspaces.css",
    "../styles/globals/surface-research-desk.css",
    "../styles/globals/surface-research-prompt.css",
    "../styles/globals/surface-research-library.css",
    "../styles/globals/surface-research-studio.css",
    "../styles/globals/surface-research-resources.css",
  ],
  "src/styles/cave-chat.css": ["./cave-chat/bubbles.css", "./cave-chat/activity.css", "./cave-chat/transcript.css", "./cave-chat/auxiliary-surfaces.css"],
  "src/styles/board.css": ["./board/chrome-table.css", "./board/kanban-inspector.css", "./board/github-list.css", "./board/github-detail.css", "./board/mobile-card-stack.css", "./board/gantt-fallbacks.css"],
  "src/styles/home-composer.css": ["./home-composer/landing-composer.css", "./home-composer/feed-menus.css", "./home-composer/digest.css", "./home-composer/hearth-continuations.css"],
  "src/styles/sidebar-minimal.css": ["./sidebar-minimal/shell-chrome.css", "./sidebar-minimal/navigation-recents.css", "./sidebar-minimal/familiars.css", "./sidebar-minimal/activity-rail.css"],
  "src/styles/cave-md.css": ["./cave-md/prose.css", "./cave-md/tables-mermaid.css", "./cave-md/code.css", "./cave-md/interactions.css"],
};

for (const [facade, expected] of Object.entries(FACADES)) {
  const source = readRawCssSync(facade, "utf8");
  assert.doesNotMatch(source, /@layer\b/, `${facade} must not change cascade priority with CSS layers`);
  const imports = [...source.matchAll(/^@import\s+"([^"@]+)";/gm)].map((match) => match[1]).filter((specifier) => specifier.startsWith("."));
  assert.deepEqual(imports, expected, `${facade} keeps the declared module cascade order`);
  for (const specifier of expected) {
    const modulePath = path.resolve(path.dirname(facade), specifier);
    const module = readRawCssSync(modulePath, "utf8");
    assert.ok(module.trim().length > 0, `${modulePath} contains extracted CSS`);
    if (!modulePath.endsWith("sidebar-minimal.css")) {
      assert.doesNotMatch(module, /^@import\s/m, `${modulePath} remains a focused leaf module`);
    }
  }
  const effective = readEffectiveCssSync(facade, "utf8");
  assert.ok(effective.length > source.length, `${facade} resolves to its effective stylesheet contract`);
}

console.log("css-module-order.test.ts OK");
