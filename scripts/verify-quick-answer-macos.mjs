import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const root = "apps/macos/SalemQuickAnswer";

const project = read(`${root}/project.yml`);
const app = read(`${root}/SalemQuickAnswer/SalemQuickAnswerApp.swift`);
const hotkey = read(`${root}/SalemQuickAnswer/GlobalHotKeyController.swift`);
const view = read(`${root}/SalemQuickAnswer/QuickAnswerView.swift`);
const model = read(`${root}/SalemQuickAnswer/Models.swift`);
const pitches = read(`${root}/SalemQuickAnswer/PitchLibrary.swift`);
const fixture = read(`${root}/SalemQuickAnswer/FixtureBriefService.swift`);
const live = read(`${root}/SalemQuickAnswer/LiveBriefService.swift`);
const credential = read(`${root}/SalemQuickAnswer/CredentialStore.swift`);
const decoder = read(`${root}/SalemQuickAnswer/StrictBriefDecoder.swift`);

assert.match(project, /platform: macOS/);
assert.match(project, /INFOPLIST_KEY_LSUIElement: YES/);
assert.match(project, /SalemQuickAnswerTests/);
assert.match(app, /NSStatusBar\.system\.statusItem/);
assert.match(app, /NSPopover/);
assert.match(app, /LiveBriefService\(\)/);
assert.match(hotkey, /kVK_Space/);
assert.match(hotkey, /optionKey/);
assert.match(view, /SAY THIS/);
assert.match(view, /Confidence:/);
assert.match(view, /Stale knowledge/);
assert.match(view, /Open reference pitches/);
assert.match(view, /Configure access/);
for (const state of [
  "lowConfidence", "stale", "offline", "unauthorized", "revoked", "rateLimited",
  "timedOut", "invalidResponse", "modelUnavailable", "serviceUnavailable", "failed",
]) {
  assert.match(model, new RegExp(`case ${state}`));
}
assert.match(pitches, /static let version/);
assert.match(pitches, /I wouldn't claim universal compatibility today/);
assert.match(pitches, /not a claim of consciousness, personhood, or legal agency/);
assert.match(fixture, /opencoven\.salem-brief\/v1/);
assert.doesNotMatch(fixture, /URLSession|https:\/\//);
assert.match(live, /https:\/\/salem\.opencoven\.ai\/api\/brief/);
assert.match(live, /Authorization/);
assert.match(live, /timeoutInterval = 12/);
assert.match(credential, /kSecClassGenericPassword/);
assert.match(credential, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
assert.match(decoder, /unsupportedSchema/);
assert.match(decoder, /known claim without evidence/);
assert.match(decoder, /verified without pinned verification evidence/);

const productSources = app + view + fixture + live + credential + decoder;
assert.doesNotMatch(
  productSources,
  /OPENAI_API_KEY|GEMINI_API_KEY|COHERE_API_KEY|SALEM_ADMIN_PASSWORD|UPSTASH_|REINDEX_SECRET|GITHUB_WEBHOOK_SECRET/,
);
assert.doesNotMatch(productSources, /UserDefaults.*question|UserDefaults.*answer/);

console.log("quick-answer-macos-source: ok");
