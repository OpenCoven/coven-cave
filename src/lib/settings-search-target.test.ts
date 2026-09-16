// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { observeSettingsTarget } from "./settings-search-target.ts";

test("waits for a delayed section, resolves once, and disconnects", () => {
  let notify;
  let disconnected = 0;
  let target = null;
  let hits = 0;
  const root = { querySelectorAll: () => target ? [target] : [] };
  const observer = () => ({ observe() {}, disconnect() { disconnected++; } });
  const stop = observeSettingsTarget(root, "settings-group-voice", () => hits++, (cb) => {
    notify = cb;
    return observer();
  });
  assert.equal(hits, 0);
  target = { id: "settings-group-other" };
  notify();
  assert.equal(hits, 0);
  target = { id: "settings-group-voice" };
  notify();
  notify();
  assert.equal(hits, 1);
  assert.equal(disconnected, 1);
  stop();
});

test("cancels a pending search when leaving its section", () => {
  let notify;
  let hits = 0;
  let target = null;
  const stop = observeSettingsTarget({ querySelectorAll: () => target ? [target] : [] }, "wanted", () => hits++, (cb) => {
    notify = cb;
    return { observe() {}, disconnect() {} };
  });
  stop();
  target = { id: "wanted" };
  notify();
  assert.equal(hits, 0);
});

test("an already mounted target resolves immediately without observing", () => {
  const target = { id: "wanted" };
  let found;
  observeSettingsTarget({ querySelectorAll: () => [target] }, "wanted", el => { found = el; }, () => {
    throw new Error("must not observe an already mounted target");
  });
  assert.equal(found, target);
});
