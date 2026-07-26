// @ts-nocheck
// Removal regression contracts.
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

const retiredRuntimePaths = [
  "./automations/automation-lists.tsx",
  "./automations/templates-panel.tsx",
  "../lib/automation-templates.ts",
  "../lib/flow/flow-execution-duration.ts",
  "../lib/flow/flow-execution-filters.ts",
  "../lib/flow/flow-node-summary.ts",
  "../lib/flow/flow-progress.ts",
  "../lib/flow/flow-prompt.ts",
  "../lib/flow/flow-templates.ts",
  "../lib/agent-completion-report.ts",
  "../lib/double-blind-eval.ts",
  "../lib/familiar-avatar-src.ts",
  "../lib/github-repo.ts",
  "../lib/project-status.ts",
  "../lib/session-pins.ts",
  "../lib/terminal-broadcast.ts",
  "../lib/use-session-pins.ts",
  "../lib/use-table-row-keynav.ts",
] as const;

test("retired interface modules and preview routes stay deleted", () => {
  const survivors = retiredPaths.filter((relativePath) =>
    existsSync(new URL(relativePath, import.meta.url)),
  );
  assert.deepEqual(survivors, []);
});

test("production-unreachable runtime modules stay deleted", () => {
  const survivors = retiredRuntimePaths.filter((relativePath) =>
    existsSync(new URL(relativePath, import.meta.url)),
  );
  assert.deepEqual(survivors, []);
});

test("packages owned only by retired runtime modules stay removed", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const retiredPackages = [
    "@create-markdown/react",
    "@milkdown/react",
    "@xyflow/react",
  ] as const;

  for (const dependency of retiredPackages) {
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      assert.equal(packageJson[section]?.[dependency], undefined);
    }
  }
});

test("BottomTerminal has no inert broadcast interface", () => {
  const terminal = readFileSync(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");

  for (const deadIdentifier of [
    "paneId",
    "registerWriter",
    "onUserInput",
    "broadcastPaneId",
    "writerRef",
  ]) {
    assert.doesNotMatch(terminal, new RegExp(`\\b${deadIdentifier}\\b`));
  }
});

test("Schedules has no residue from its retired All, Flow, or Templates surfaces", () => {
  const schedules = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");
  const wrapper = readFileSync(
    new URL("./inbox-escalations-view.tsx", import.meta.url),
    "utf8",
  );
  const createDialog = readFileSync(
    new URL("./automation-create-dialog.tsx", import.meta.url),
    "utf8",
  );
  const responsiveStyles = readFileSync(
    new URL("../styles/globals/calendar-agenda.css", import.meta.url),
    "utf8",
  );
  const authoringGuide = readFileSync(
    new URL("../../docs/authoring-assist.md", import.meta.url),
    "utf8",
  );

  for (const deadIdentifier of [
    "SCHEDULE_MODE_LABEL",
    "templatesQuery",
    "templateInitialValues",
    "openEntry",
    "runEntry",
    "togglePauseEntry",
    "entryPausable",
    "AutomationAllList",
    "FlowList",
    "TemplatesPanel",
    "buildAutomationEntries",
    "filterEntries",
    "countByType",
  ]) {
    assert.doesNotMatch(schedules, new RegExp(`\\b${deadIdentifier}\\b`));
  }

  assert.doesNotMatch(
    wrapper,
    /\bonOpenSource\b|\bactiveFamiliarId\b|\bonOpenSession\b|\bdefaultTab\b/,
  );
  assert.doesNotMatch(
    createDialog,
    /\bAutomationCreateInitialValues\b|\binitialValues\b/,
  );
  assert.doesNotMatch(responsiveStyles, /\.automation-template(?:s|-card)/);
  assert.doesNotMatch(
    authoringGuide,
    /\bAUTOMATION_TEMPLATES\b|src\/lib\/automation-templates\.ts/,
  );
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
