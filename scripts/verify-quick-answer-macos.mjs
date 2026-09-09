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

assert.match(project, /platform: macOS/);
assert.match(project, /INFOPLIST_KEY_LSUIElement: YES/);
assert.match(project, /SalemQuickAnswerTests/);
assert.match(app, /NSStatusBar\.system\.statusItem/);
assert.match(app, /NSPopover/);
assert.match(hotkey, /kVK_Space/);
assert.match(hotkey, /optionKey/);
assert.match(view, /SAY THIS/);
assert.match(view, /Confidence:/);
assert.match(view, /Stale knowledge/);
assert.match(view, /Open reference pitches/);
assert.match(model, /case lowConfidence/);
assert.match(model, /case stale/);
assert.match(model, /case offline/);
assert.match(model, /case unauthorized/);
assert.match(model, /case rateLimited/);
assert.match(model, /case failed/);
assert.match(pitches, /Reference|version/);
assert.match(pitches, /I wouldn't claim universal compatibility today/);
assert.match(pitches, /not a claim of consciousness, personhood, or legal agency/);
assert.match(fixture, /opencoven\.salem-brief\/v1/);
assert.doesNotMatch(fixture, /URLSession|https:\/\//);
assert.doesNotMatch(app + view + fixture, /OPENAI_API_KEY|SALEM_ADMIN_PASSWORD|UPSTASH_/);

console.log("quick-answer-macos-source: ok");
