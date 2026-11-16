import assert from "node:assert/strict";
import test from "node:test";
import { readChatComposerPrefs, writeChatComposerPrefs, restoreReviewedPermissionMode } from "./chat-composer-prefs.ts";

test("chat composer preferences validate stale storage values and round-trip known values", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  const defaults = readChatComposerPrefs(storage);
  writeChatComposerPrefs(storage, defaults);
  assert.deepEqual(readChatComposerPrefs(storage), defaults);
  data.set("cave:chat-composer-controls:v1", JSON.stringify({ thinkingEffort: "bad", responseSpeed: "bad", permissionMode: "bad" }));
  assert.deepEqual(readChatComposerPrefs(storage), defaults);
});


test("the reviewed host mode restores on a new origin without replacing a saved user choice", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  assert.equal(restoreReviewedPermissionMode(storage, "read"), true);
  assert.equal(readChatComposerPrefs(storage).permissionMode, "read");
  writeChatComposerPrefs(storage, { ...readChatComposerPrefs(storage), permissionMode: "full", thinkingEffort: "high" });
  assert.equal(restoreReviewedPermissionMode(storage, "read"), false);
  assert.equal(readChatComposerPrefs(storage).permissionMode, "full");
  assert.equal(readChatComposerPrefs(storage).thinkingEffort, "high");
});

test("automatic composer initialization cannot turn its fallback mode into a saved choice before host restoration", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  writeChatComposerPrefs(storage, { thinkingEffort: "low", responseSpeed: "careful", permissionMode: "full" }, "automatic");
  assert.equal(restoreReviewedPermissionMode(storage, "read"), true);
  assert.deepEqual(readChatComposerPrefs(storage), { thinkingEffort: "low", responseSpeed: "careful", permissionMode: "read" });
});

test("automatic updates from a bound chat preserve the restored mode for future chats", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  assert.equal(restoreReviewedPermissionMode(storage, "read"), true);
  writeChatComposerPrefs(storage, { thinkingEffort: "medium", responseSpeed: "balanced", permissionMode: "full" }, "automatic");
  assert.deepEqual(readChatComposerPrefs(storage), { thinkingEffort: "medium", responseSpeed: "balanced", permissionMode: "read" });
});

test("automatic updates preserve an explicit local Build choice across a reviewed Explore host default", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  writeChatComposerPrefs(storage, { thinkingEffort: "high", responseSpeed: "fast", permissionMode: "full" });
  writeChatComposerPrefs(storage, { thinkingEffort: "low", responseSpeed: "balanced", permissionMode: "read" }, "automatic");
  assert.equal(restoreReviewedPermissionMode(storage, "read"), false);
  assert.equal(readChatComposerPrefs(storage).permissionMode, "full");
});
