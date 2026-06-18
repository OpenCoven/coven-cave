import assert from "node:assert/strict";
import {
  CODE_PRESET_CHAT_SIZE,
  CODE_PRESET_ICONS,
  CODE_PRESET_LABELS,
  CODE_PRESET_KEY,
  CODE_PRESETS,
  DEFAULT_CODE_PRESET,
  normalizeCodePreset,
  readCodePreset,
} from "./code-layout-preset.ts";

assert.deepEqual([...CODE_PRESETS], ["chat", "split", "review"], "three presets, ordered");
assert.equal(DEFAULT_CODE_PRESET, "split", "default is the balanced split");
assert.equal(CODE_PRESET_KEY, "cave.code.preset.v1", "stable storage key");

// normalizeCodePreset: pass through known, fall back to default otherwise.
for (const p of CODE_PRESETS) {
  assert.equal(normalizeCodePreset(p), p, `${p} passes through`);
}
assert.equal(normalizeCodePreset("bogus"), DEFAULT_CODE_PRESET, "unknown → default");
assert.equal(normalizeCodePreset(undefined), DEFAULT_CODE_PRESET, "undefined → default");
assert.equal(normalizeCodePreset(null), DEFAULT_CODE_PRESET, "null → default");

// Every preset has a chat-pane width within the code-chat panel's 28%–75% band,
// a label, and a whitelisted icon name.
for (const p of CODE_PRESETS) {
  const size = CODE_PRESET_CHAT_SIZE[p];
  assert.match(size, /^\d+%$/, `${p} chat size is a percent string`);
  const pct = Number.parseInt(size, 10);
  assert.ok(pct >= 28 && pct <= 75, `${p} chat size ${size} is within the panel min/max band`);
  assert.ok(CODE_PRESET_LABELS[p].length > 0, `${p} has a label`);
  assert.match(CODE_PRESET_ICONS[p], /^ph:/, `${p} has a phosphor icon`);
}

// review gives comux the most room; chat the least; split sits between.
const chatPct = (p: (typeof CODE_PRESETS)[number]) => Number.parseInt(CODE_PRESET_CHAT_SIZE[p], 10);
assert.ok(chatPct("chat") > chatPct("split"), "chat preset is wider than split");
assert.ok(chatPct("split") > chatPct("review"), "split is wider than review");

// SSR / no-window: readCodePreset must not throw and returns the default.
assert.equal(readCodePreset(), DEFAULT_CODE_PRESET, "readCodePreset is SSR-safe");

console.log("code-layout-preset.test.ts: ok");
