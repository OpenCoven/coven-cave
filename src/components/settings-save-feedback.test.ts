// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toast = readFileSync(new URL("./ui/settings-save-toast.tsx", import.meta.url), "utf8");
const feedback = readFileSync(new URL("../lib/settings-save-feedback.ts", import.meta.url), "utf8");
const toastStyles = readFileSync(new URL("../styles/globals/shared-pickers-and-toasts.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const familiarSettings = readFileSync(new URL("./familiar-tab-settings.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const identity = readFileSync(new URL("./familiar-studio-identity-tab.tsx", import.meta.url), "utf8");
const brain = readFileSync(new URL("./familiar-studio-brain-tab.tsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("./chat-settings-view.tsx", import.meta.url), "utf8");
const look = readFileSync(new URL("./familiar-studio-look-tab.tsx", import.meta.url), "utf8");
const voice = readFileSync(new URL("./voice-provider-settings.tsx", import.meta.url), "utf8");
const fonts = readFileSync(new URL("./settings-fonts.tsx", import.meta.url), "utf8");
const backdrop = readFileSync(new URL("./backdrop-settings.tsx", import.meta.url), "utf8");

assert.match(toast, /SETTINGS_SAVED_EVENT/, "the toast listens to the shared save event");
assert.match(toast, /role="status"/, "saved feedback is announced politely");
assert.match(toast, /DISMISS_AFTER_MS/, "saved feedback dismisses automatically");
assert.match(toast, /aria-label="Dismiss saved notification"/, "saved feedback can be dismissed");
assert.match(
  feedback,
  /const saved = await flushAppPreferences\(\);\s*if \(saved\) showSettingsSavedToast\(message\)/,
  "canonical preferences report success only after persistence",
);
assert.match(
  toastStyles,
  /\.ui-save-toast\s*\{\s*bottom:/,
  "saved feedback uses a distinct slot from destructive undo feedback",
);

assert.equal(
  (layout.match(/<SettingsSaveToast \/>/g) ?? []).length,
  1,
  "the app has exactly one global saved-feedback host",
);
assert.doesNotMatch(shell, /<SettingsSaveToast \/>/, "app Settings does not create a duplicate host");
assert.doesNotMatch(familiarSettings, /<SettingsSaveToast \/>/, "Familiar Settings does not create a duplicate host");

assert.match(identity, /leadingIcon="ph:floppy-disk-bold"[\s\S]*?Save/, "identity fields expose Save buttons");
assert.match(identity, /disabled=\{!dirty\}/, "identity Save buttons enable only for changed drafts");
assert.doesNotMatch(identity, /onBlur:\s*commit/, "identity drafts do not save implicitly on blur");
assert.match(identity, /if \(!dirty\) return;/, "unchanged identity fields do not claim a save");
assert.match(identity, /setDraft\(""\);\s*if \(hasOverride\) onReset\(\)/, "empty identity drafts settle without a false reset");

assert.match(brain, /showSettingsSavedToast\(\)/, "familiar auto-saves show visible feedback");
assert.equal(
  (chat.match(/showSettingsSavedToast\(\)/g) ?? []).length,
  2,
  "both chat policy auto-save paths show visible feedback",
);
assert.ok(
  (look.match(/showSettingsSavedToast\(\)/g) ?? []).length >= 3
    && (look.match(/showSettingsSavedAfterPreferencesFlush\(\)/g) ?? []).length >= 1,
  "familiar appearance auto-saves show visible feedback",
);
assert.match(
  voice,
  /showSettingsSavedAfterPreferencesFlush\(\)/,
  "voice preferences report success only after canonical persistence",
);
assert.ok(
  (fonts.match(/showSettingsSavedAfterPreferencesFlush\(\)/g) ?? []).length >= 9,
  "typography auto-saves show visible feedback",
);
assert.ok(
  (backdrop.match(/showSettingsSavedAfterPreferencesFlush\(/g) ?? []).length >= 7,
  "backdrop auto-saves show visible feedback",
);
assert.match(
  shell,
  /void showSettingsSavedAfterPreferencesFlush\(\)/,
  "canonical appearance preferences report success only after persistence",
);

console.log("settings-save-feedback.test.ts: ok");
