// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const retiredPaths = [
  "../app/mockup/page.tsx",
  "../app/mockup/mockup.css",
  "../app/mockup/familiar-chatout-codex/page.tsx",
  "../app/preview/fonts/page.tsx",
  "./code-quick-open.tsx",
  "./familiar-panel.tsx",
  "./familiar-studio-contract-tab.tsx",
  "./required-inputs-dialog.tsx",
  "./skill-card.tsx",
  "./home/home-digest-carousel.tsx",
  "./home/home-open-work.tsx",
  "./home/home-snippets.tsx",
  "./home/use-board-cards.ts",
  "./home/use-home-disclosure.ts",
  "../lib/home-digest.ts",
  "../lib/home-news-pref.ts",
  "../styles/home-composer/digest.css",
] as const;

test("retired interface modules and preview routes stay deleted", () => {
  const survivors = retiredPaths.filter((relativePath) =>
    existsSync(new URL(relativePath, import.meta.url)),
  );
  assert.deepEqual(survivors, []);
});

test("live interface code has no inert plumbing for retired Home sections", () => {
  const composer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
  const themeBootstrap = readFileSync(
    new URL("../../public/scripts/theme-init.js", import.meta.url),
    "utf8",
  );

  for (const deadProp of ["needsYou", "onOpenInboxItem", "onOpenSchedules"]) {
    assert.doesNotMatch(composer, new RegExp(`\\b${deadProp}\\b`));
  }
  assert.doesNotMatch(workspace, /<HomeComposer[^>]*\bneedsYou=/);
  assert.doesNotMatch(workspace, /<HomeComposer[^>]*\bonOpenInboxItem=/);
  assert.doesNotMatch(workspace, /<HomeComposer[^>]*\bonOpenSchedules=/);
  assert.doesNotMatch(settings, /HomeNewsToggle|useHomeNewsEnabled|writeHomeNewsEnabled/);
  assert.doesNotMatch(settings, /label="News headlines"/);
  assert.doesNotMatch(themeBootstrap, /home-news|newsHeadlines/);
});

test("retired route and style contracts are removed from live inventories", () => {
  const routes = readFileSync(new URL("../app/route-inventory.test.ts", import.meta.url), "utf8");
  const homeCss = readFileSync(new URL("../styles/home-composer.css", import.meta.url), "utf8");
  const hearthCss = readFileSync(
    new URL("../styles/home-composer/hearth-continuations.css", import.meta.url),
    "utf8",
  );
  const primitives = readFileSync(new URL("../styles/globals/primitives.css", import.meta.url), "utf8");
  const shellResponsive = readFileSync(
    new URL("../styles/globals/shell-responsive.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(routes, /"\/mockup|"\/preview\/fonts/);
  assert.doesNotMatch(homeCss, /digest\.css/);
  assert.doesNotMatch(hearthCss, /\.home-disclosure|\.home-work-row/);
  assert.doesNotMatch(primitives, /\.required-inputs-/);
  assert.doesNotMatch(shellResponsive, /\.familiar-studio-contract/);
});
