// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const component = readFileSync(new URL("./retro-runs-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const slash = readFileSync(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");
const apiRoute = readFileSync(new URL("../app/api/retro-runs/route.ts", import.meta.url), "utf8");
const evalLoopRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/route.ts", import.meta.url), "utf8");
const retroPageUrl = new URL("../app/dashboard/retro/page.tsx", import.meta.url);

assert.equal(existsSync(retroPageUrl), true, "dedicated /dashboard/retro page exists");
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
assert.match(workspace, /retro: "Eval Loops"/, "workspace has an Eval Loops mode title");
assert.match(
  workspace,
  /const retroFamiliarId = activeId \?\? familiars\[0\]\?\.id \?\? null/,
  "workspace Retro mode should collapse All familiars to one familiar instead of aggregating every familiar",
);
assert.match(workspace, /<RetroRunsView familiarId=\{retroFamiliarId\}/, "workspace renders Retro Runs scoped to one familiar");
assert.match(sidebar, /\{ id: "retro", label: "Eval Loops"/, "desktop sidebar should expose Eval Loops as an optional surface");
assert.match(sidebar, /if \(fm\.id === "retro"\) return addons\?\.retro === true;/, "Eval Loops sidebar row should be add-on gated");
assert.match(settings, /\|\s*"retro"/, "Settings add-on keys should include retro");
assert.match(settings, /key: "retro"[\s\S]{0,120}label: "Eval Loops"/, "Settings should expose the Eval Loops add-on");
assert.match(slash, /name: "\/evals"[\s\S]{0,120}Eval Loops/, "slash command catalog should include /evals for Eval Loops");
assert.doesNotMatch(mobileTabs, /id: "retro"/, "mobile bottom tabs should not expose a Retro tab");

console.log("retro-runs-view.test.ts: ok");
