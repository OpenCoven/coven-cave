import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { THEME_SYNC_KEYS } from "./theme-sync-keys.ts";

test("native semantic surfaces, borders, and state colors are published", () => {
  for (const token of [
    "--bg-panel", "--bg-base", "--bg-raised", "--bg-elevated", "--bg-subtle", "--bg-sunken",
    "--border-hairline", "--border-strong", "--text-primary", "--text-secondary", "--text-muted", "--accent-presence",
    "--color-info",
    ...["success", "warning", "danger"].flatMap((state) => [`--color-${state}`, `--color-${state}-soft`]),
  ]) assert.ok(THEME_SYNC_KEYS.includes(token), token);
  assert.equal(new Set(THEME_SYNC_KEYS).size, THEME_SYNC_KEYS.length);
});

test("both publishers consume the same token contract and native mappings cover every key", () => {
  for (const path of ["settings-appearance.tsx", "remote-theme-controller.tsx"]) {
    const source = readFileSync(new URL(`../components/${path}`, import.meta.url), "utf8");
    assert.match(source, /import \{ THEME_SYNC_KEYS \} from "@\/lib\/theme-sync-keys"/);
    assert.match(source, /(?:for \(const key of THEME_SYNC_KEYS\)|resolveTokens\(THEME_SYNC_KEYS\))/);
    assert.doesNotMatch(source, /const THEME_SYNC_KEYS =/);
  }
  const native = readFileSync(new URL("../../apps/ios/CovenCave/CovenCave/Theme/Theme.swift", import.meta.url), "utf8");
  for (const key of THEME_SYNC_KEYS) assert.ok(native.includes(`t["${key}"]`), `native mapping for ${key}`);
});

 test("published keys exist in canonical CSS", () => {
  const css = readFileSync(new URL("../styles/globals/foundations.css", import.meta.url), "utf8");
  for (const key of THEME_SYNC_KEYS) assert.ok(css.includes(`${key}:`), key);
});
