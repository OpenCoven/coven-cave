// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./dev-cache-reset-script.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

assert.match(src, /process\.env\.NODE_ENV !== "development"/, "script should render only in development");
assert.match(src, /navigator\.serviceWorker\.getRegistrations\(\)/, "script should inspect existing service workers before hydration");
assert.match(src, /registration\.unregister\(\)/, "script should unregister stale service workers");
assert.match(src, /caches\.keys\(\)/, "script should inspect browser caches before hydration");
assert.match(src, /covencave-pwa/, "script should target CovenCave PWA caches");
assert.match(src, /window\.location\.reload\(\)/, "script should reload once after removing stale state");
assert.match(layout, /<DevCacheResetScript \/>[\s\S]*<SidecarAuthBridge \/>/, "dev cache reset should run before app client scripts");

console.log("dev-cache-reset-script.test.ts OK");
