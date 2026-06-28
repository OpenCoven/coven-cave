// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const component = readFileSync(new URL("./retro-runs-view.tsx", import.meta.url), "utf8");
const evals = readFileSync(new URL("./evals/evals-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const slash = readFileSync(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");
const commandPalette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const apiRoute = readFileSync(new URL("../app/api/retro-runs/route.ts", import.meta.url), "utf8");
const evalLoopRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/route.ts", import.meta.url), "utf8");
const dashboardRetroPage = readFileSync(new URL("../app/dashboard/retro/page.tsx", import.meta.url), "utf8");
const retroRedirectPage = readFileSync(new URL("../app/retro/page.tsx", import.meta.url), "utf8");
const retroPageUrl = new URL("../app/dashboard/retro/page.tsx", import.meta.url);

assert.equal(existsSync(retroPageUrl), true, "legacy /dashboard/retro page still exists as a redirect");
assert.match(dashboardRetroPage, /redirect\("\/dashboard\?view=evals"\)/, "legacy /dashboard/retro redirects to unified Evals");
assert.match(retroRedirectPage, /redirect\("\/dashboard\?view=evals"\)/, "legacy /retro redirects to unified Evals");
assert.match(
  component,
  /familiarId \? `\/api\/retro-runs\?familiarId=\$\{encodeURIComponent\(familiarId\)\}` : "\/api\/retro-runs"/,
  "RetroRunsView should request a single familiar when familiarId is supplied and retain aggregate fallback",
);
assert.match(component, /fetch\(apiPath/, "RetroRunsView loads retro runs through the scoped API path");
assert.match(component, /downloadRetroSnapshot/, "RetroRunsView offers a sanitized export");
assert.match(component, /JSON\.stringify\(snapshot/, "exports the API snapshot rather than raw daemon payloads");
assert.match(component, /<Tabs[\s\S]{0,160}variant="segment"/, "track filters use the shared segment Tabs");
assert.match(component, /ariaLabel="Eval loop track filter"/, "track filter tablist is labelled for Eval Loops");
assert.match(component, /aria-label="Refresh eval loops"/, "refresh is an icon button with an accessible name");
assert.match(apiRoute, /redactSecretsDeep/, "aggregate retro API redacts daemon data at the route boundary");
assert.match(evalLoopRoute, /redactSecretsDeep/, "per-familiar eval-loop proxy redacts daemon data too");
assert.match(evals, /RetroRunsView/, "unified Evals embeds the sanitized eval-loop run list");
assert.match(evals, /EvalLoopPanel/, "unified Evals embeds eval-loop run and recovery controls");
assert.match(workspace, /retro: "Evals"/, "legacy retro mode is titled as Evals");
assert.match(
  workspace,
  /const retroFamiliarId = activeId \?\? familiars\[0\]\?\.id \?\? null/,
  "workspace keeps a familiar fallback for legacy retro mode",
);
assert.match(workspace, /mode === "evals" \|\| mode === "retro"/, "workspace renders unified Evals for canonical and legacy modes");
assert.doesNotMatch(sidebar, /\{ id: "retro", label: "Eval Loops"/, "desktop sidebar should not expose a duplicate Eval Loops surface");
assert.doesNotMatch(sidebar, /if \(fm\.id === "retro"\) return addons\?\.retro === true;/, "sidebar should not gate a removed retro add-on");
assert.doesNotMatch(commandPalette, /if \(fm\.id === "retro"\) return addons\?\.retro === true;/, "command palette should not expose a duplicate retro add-on");
assert.doesNotMatch(settings, /\|\s*"retro"/, "Settings add-on keys should not include retro");
assert.doesNotMatch(settings, /key: "retro"[\s\S]{0,120}label: "Eval Loops"/, "Settings should not expose a duplicate Eval Loops add-on");
assert.match(slash, /name: "\/evals"[\s\S]{0,120}Open Evals/, "slash command catalog should open unified Evals");
assert.match(slash, /aliases: \["\/eval-loops"\]/, "slash command keeps /eval-loops as a compatibility alias");
assert.doesNotMatch(mobileTabs, /id: "retro"/, "mobile bottom tabs should not expose a Retro tab");

console.log("retro-runs-view.test.ts: ok");
