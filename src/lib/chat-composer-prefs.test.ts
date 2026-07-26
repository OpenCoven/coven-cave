import assert from "node:assert/strict";
import test from "node:test";
import { readChatComposerPrefs, writeChatComposerPrefs } from "./chat-composer-prefs.ts";

test("chat composer preferences validate stale storage values and round-trip known values", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  const defaults = readChatComposerPrefs(storage);
  writeChatComposerPrefs(storage, defaults);
  assert.deepEqual(readChatComposerPrefs(storage), defaults);
  data.set("cave:chat-composer-controls:v1", JSON.stringify({ thinkingEffort: "bad", responseSpeed: "bad", permissionMode: "bad" }));
  assert.deepEqual(readChatComposerPrefs(storage), defaults);
});
