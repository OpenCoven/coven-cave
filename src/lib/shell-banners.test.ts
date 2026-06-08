// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./shell-banners.ts", import.meta.url), "utf8");

assert.match(source, /export type BannerSeverity = "error" \| "warning" \| "info"/);
assert.match(source, /export type ShellBanner/);
assert.match(source, /export function useShellBanners\(\)/);
assert.match(source, /export function ShellBannersProvider/);
assert.match(source, /pushBanner/);
assert.match(source, /dismissBanner/);
assert.match(
  source,
  /sort.*severity|error.*warning.*info/i,
  "Banners must be ordered error -> warning -> info",
);
