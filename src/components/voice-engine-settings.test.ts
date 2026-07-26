// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./voice-engine-settings.tsx", import.meta.url), "utf8");

test("local speech settings manages the verified model registry through supported endpoints", () => {
  assert.match(source, /fetch\("\/api\/voice\/engines", \{ cache: "no-store" \}\)/);
  assert.match(source, /fetch\("\/api\/voice\/engines\/downloads", \{ cache: "no-store" \}\)/);
  assert.match(source, /method: action === "download" \? "POST" : "DELETE"/);
  assert.match(source, /model\.ready && model\.verified/);
  assert.match(source, /cave:voice-engines-refresh/);
  assert.match(source, /setTimeout\(\(\) => \{ void refresh\(true\); \}, 1_000\)/);
  assert.match(source, /if \(hadActiveDownload\.current\)[\s\S]{0,120}notifyCatalogChanged\(\)/);
});
