// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sent = [];
globalThis.fetch = async (_url, init) => {
  sent.push(JSON.parse(init?.body ?? "{}"));
  return { ok: true, status: 200, json: async () => ({ preferences: null }) };
};

const {
  quickChatShortcutLabel,
  readQuickChatShortcutEnabled,
  setQuickChatShortcutEnabled,
} = await import("./quick-chat-shortcut-pref.ts");

test("the shortcut is labelled for the platform that holds it", () => {
  assert.equal(quickChatShortcutLabel(true), "⌘⇧Space");
  assert.equal(quickChatShortcutLabel(false), "Ctrl+Shift+Space");
});

test("the shortcut is off until the person turns it on", () => {
  assert.equal(readQuickChatShortcutEnabled(), false);
});

test("the toggle saves what the shell actually registered", async () => {
  const asked = [];
  assert.equal(await setQuickChatShortcutEnabled(true, async (enabled) => { asked.push(enabled); return true; }), true);
  assert.deepEqual(asked, [true], "the shell is asked before anything is saved");
  assert.equal(readQuickChatShortcutEnabled(), true);
  assert.equal(await setQuickChatShortcutEnabled(false, async () => false), false);
  assert.equal(readQuickChatShortcutEnabled(), false);
});

test("a key another app holds is never saved as on", async () => {
  await assert.rejects(
    setQuickChatShortcutEnabled(true, async () => { throw new Error("another app holds the key"); }),
  );
  assert.equal(readQuickChatShortcutEnabled(), false, "the refusal leaves the saved preference off");
});

test("the Settings toggle is desktop-only and goes through the shell", () => {
  const settings = readFileSync(new URL("../components/settings-shell.tsx", import.meta.url), "utf8");
  const toggle = settings.slice(settings.indexOf("function QuickChatShortcutToggle"), settings.indexOf("// Stop phrases are a safety valve"));
  assert.match(toggle, /const desktop = useIsTauriDesktop\(\);[\s\S]*if \(!desktop\) return null;/, "the browser and phone never show it");
  assert.match(toggle, /await setQuickChatShortcutEnabled\(next\)/, "the toggle asks the shell before saving");
  assert.match(toggle, /role="switch"[\s\S]*aria-checked=\{enabled\}/, "it is an accessible switch");
  assert.match(settings, /<StopPhraseField \/>\s*<QuickChatShortcutToggle \/>/, "it sits in the Chat group");
});
