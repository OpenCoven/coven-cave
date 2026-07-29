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
  assert.match(source, /const downloadRunning = job\?\.status === "running"/);
  assert.match(source, /ready \|\| downloadRunning[\s\S]{0,280}Cancel download/);
  assert.match(source, /cave:voice-engines-refresh/);
  assert.match(source, /setTimeout\(\(\) => \{ void refresh\(true\); \}, 1_000\)/);
  assert.match(source, /if \(hadActiveDownload\.current\)[\s\S]{0,120}notifyCatalogChanged\(\)/);
});

test("local speech presents the reference count, metadata, and bounded catalog", () => {
  assert.match(source, /const COLLAPSED_MODEL_COUNT = 3/);
  assert.match(source, /readyCount/);
  assert.match(source, /formatVoiceModelMetadata/);
  assert.match(source, /visibleVoiceModels/);
  assert.match(source, /job\?\.status === "running"/);
  assert.match(source, /expanded \? "Show fewer voices" : `Show all \$\{models\.length\} voices`/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /variant="ruled"/);
  assert.match(source, /meta=\{`\$\{readyCount\}\/\$\{models\.length\}`\}/);
});
