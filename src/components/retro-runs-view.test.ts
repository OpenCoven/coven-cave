// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const component = readFileSync(new URL("./retro-runs-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const apiRoute = readFileSync(new URL("../app/api/retro-runs/route.ts", import.meta.url), "utf8");
const evalLoopRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/route.ts", import.meta.url), "utf8");
const retroPageUrl = new URL("../app/dashboard/retro/page.tsx", import.meta.url);

assert.equal(existsSync(retroPageUrl), true, "dedicated /dashboard/retro page exists");
assert.match(component, /fetch\("\/api\/retro-runs"/, "RetroRunsView loads the aggregate retro API");
assert.match(component, /downloadRetroSnapshot/, "RetroRunsView offers a sanitized export");
assert.match(component, /JSON\.stringify\(snapshot/, "exports the API snapshot rather than raw daemon payloads");
assert.match(component, /role="tablist"/, "track filters use a segmented tablist control");
assert.match(component, /aria-label="Refresh retro runs"/, "refresh is an icon button with an accessible name");
assert.match(apiRoute, /redactSecretsDeep/, "aggregate retro API redacts daemon data at the route boundary");
assert.match(evalLoopRoute, /redactSecretsDeep/, "per-familiar eval-loop proxy redacts daemon data too");
assert.match(workspace, /retro: "Retro Runs"/, "workspace has a Retro Runs mode title");
assert.match(workspace, /<RetroRunsView/, "workspace renders the Retro Runs surface");
assert.match(sidebar, /id: "retro"/, "desktop sidebar exposes Retro Runs");
assert.match(mobileTabs, /id: "retro"/, "mobile bottom tabs expose Retro Runs");
assert.match(dashboard, /href="\/dashboard\/retro"/, "dashboard quick links include Retro Runs");

console.log("retro-runs-view.test.ts: ok");
