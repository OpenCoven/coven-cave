import assert from "node:assert/strict";
import {
  CODE_PRESET_COLUMN_FLEX,
  CODE_PRESET_ICONS,
  CODE_PRESET_LABELS,
  CODE_PRESET_KEY,
  CODE_PRESET_RIGHT_VIEW,
  CODE_PRESETS,
  DEFAULT_CODE_PRESET,
  normalizeCodePreset,
  readCodePreset,
} from "./code-layout-preset.ts";

assert.deepEqual([...CODE_PRESETS], ["code", "changes"], "two Code workspace toggles, ordered");
assert.equal(DEFAULT_CODE_PRESET, "code", "default is the chat-forward Code view");
assert.equal(CODE_PRESET_KEY, "cave.code.preset.v1", "stable storage key");

// normalizeCodePreset: pass through known, fall back to default otherwise.
for (const p of CODE_PRESETS) {
  assert.equal(normalizeCodePreset(p), p, `${p} passes through`);
}
assert.equal(normalizeCodePreset("bogus"), DEFAULT_CODE_PRESET, "unknown → default");
assert.equal(normalizeCodePreset(undefined), DEFAULT_CODE_PRESET, "undefined → default");
assert.equal(normalizeCodePreset(null), DEFAULT_CODE_PRESET, "null → default");

// Every preset has a label, a whitelisted icon name, a right-pane target, and
// a 2:1 column weighting between chat and the worktree pane.
for (const p of CODE_PRESETS) {
  assert.ok(CODE_PRESET_LABELS[p].length > 0, `${p} has a label`);
  assert.match(CODE_PRESET_ICONS[p], /^ph:/, `${p} has a phosphor icon`);
  assert.match(CODE_PRESET_RIGHT_VIEW[p], /^(files|changes)$/, `${p} has a concrete right-pane target`);
  assert.equal(
    CODE_PRESET_COLUMN_FLEX[p].chat + CODE_PRESET_COLUMN_FLEX[p].worktree,
    3,
    `${p} keeps a 3-part layout`,
  );
}

assert.deepEqual(CODE_PRESET_COLUMN_FLEX.code, { chat: 2, worktree: 1 }, "Code gives chat 2/3 of the two-pane surface");
assert.deepEqual(CODE_PRESET_COLUMN_FLEX.changes, { chat: 1, worktree: 2 }, "Changes gives diffs 2/3 of the two-pane surface");
assert.equal(CODE_PRESET_RIGHT_VIEW.code, "files", "Code opens the code/file preview pane");
assert.equal(CODE_PRESET_RIGHT_VIEW.changes, "changes", "Changes opens the git diff pane");

// SSR / no-window: readCodePreset must not throw and returns the default.
assert.equal(readCodePreset(), DEFAULT_CODE_PRESET, "readCodePreset is SSR-safe");

console.log("code-layout-preset.test.ts: ok");
