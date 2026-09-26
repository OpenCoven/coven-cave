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

// #5530: surfaces defer to the shell's daemon banner instead of stacking a
// second warning for the same outage.
const { hasDaemonShellBanner, DAEMON_SHELL_BANNER_IDS } = await import("./shell-banners.ts");
assert.deepEqual([...DAEMON_SHELL_BANNER_IDS].sort(), ["daemon-offline", "daemon-status-unavailable"]);
assert.equal(hasDaemonShellBanner([{ id: "daemon-status-unavailable" }]), true);
assert.equal(hasDaemonShellBanner([{ id: "update-available" }, { id: "daemon-offline" }]), true);
assert.equal(hasDaemonShellBanner([{ id: "daemon-start-error" }]), false, "a failed start is an action error, not the outage banner");
assert.equal(hasDaemonShellBanner([]), false);
assert.match(source, /export function useDaemonShellBannerVisible\(\): boolean \{\n  const ctx = useContext\(ShellBannersContext\);\n  return ctx \?/, "safe outside ShellBannersProvider");
