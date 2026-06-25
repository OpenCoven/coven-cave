// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSemver,
  compareSemver,
  isUpdateAvailable,
  resolveDownloadUrls,
  downloadTargetFor,
  pickDownloadUrl,
} from "./app-update.ts";

// Mirrors a real release's asset list (see releases/v0.0.114).
const ASSETS = [
  { name: "CovenCave-v0.0.114-aarch64.app.tar.gz", browser_download_url: "u/mac-arm-updater" },
  { name: "CovenCave-v0.0.114-aarch64.app.tar.gz.sig", browser_download_url: "u/mac-arm-sig" },
  { name: "CovenCave-v0.0.114-aarch64.dmg", browser_download_url: "u/mac-arm-dmg" },
  { name: "CovenCave-v0.0.114-x86_64.app.tar.gz", browser_download_url: "u/mac-x64-updater" },
  { name: "CovenCave-v0.0.114-x86_64.dmg", browser_download_url: "u/mac-x64-dmg" },
  { name: "CovenCave_0.0.114_amd64.AppImage", browser_download_url: "u/linux-appimage" },
  { name: "CovenCave_0.0.114_amd64.AppImage.sig", browser_download_url: "u/linux-sig" },
  { name: "CovenCave_0.0.114_x64_en-US.msi", browser_download_url: "u/win-msi" },
  { name: "CovenCave_0.0.114_x64_en-US.msi.sig", browser_download_url: "u/win-sig" },
  { name: "latest.json", browser_download_url: "u/latest-json" },
  { name: "SHA256SUMS", browser_download_url: "u/sums" },
];

test("parseSemver handles plain and v-prefixed versions", () => {
  assert.deepEqual(parseSemver("0.0.80"), [0, 0, 80]);
  assert.deepEqual(parseSemver("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseSemver("v0.0.81-beta.1"), [0, 0, 81]); // suffix ignored
  assert.equal(parseSemver("not-a-version"), null);
});

test("compareSemver orders by major.minor.patch", () => {
  assert.equal(compareSemver("0.0.81", "0.0.80"), 1);
  assert.equal(compareSemver("0.0.80", "0.0.81"), -1);
  assert.equal(compareSemver("0.0.80", "0.0.80"), 0);
  assert.equal(compareSemver("0.1.0", "0.0.99"), 1);
  assert.equal(compareSemver("1.0.0", "0.9.9"), 1);
  assert.equal(compareSemver("v0.0.81", "0.0.80"), 1); // mixed prefix
});

test("compareSemver returns 0 for unparseable input (fail-safe: no false update)", () => {
  assert.equal(compareSemver("garbage", "0.0.80"), 0);
  assert.equal(compareSemver("0.0.80", ""), 0);
});

test("isUpdateAvailable is true only when latest is strictly newer", () => {
  assert.equal(isUpdateAvailable("0.0.81", "0.0.80"), true);
  assert.equal(isUpdateAvailable("0.0.80", "0.0.80"), false);
  assert.equal(isUpdateAvailable("0.0.79", "0.0.80"), false);
  assert.equal(isUpdateAvailable("garbage", "0.0.80"), false);
});

test("resolveDownloadUrls picks the end-user installer per platform, skips updater + .sig artifacts", () => {
  const d = resolveDownloadUrls(ASSETS);
  assert.equal(d["darwin-aarch64"], "u/mac-arm-dmg"); // DMG, not the .app.tar.gz updater
  assert.equal(d["darwin-x86_64"], "u/mac-x64-dmg");
  assert.equal(d["windows-x86_64"], "u/win-msi"); // .msi, not its .sig
  assert.equal(d["linux-x86_64"], "u/linux-appimage");
});

test("resolveDownloadUrls returns only the targets it found", () => {
  const d = resolveDownloadUrls([
    { name: "CovenCave_0.0.114_x64_en-US.msi", browser_download_url: "u/win-msi" },
  ]);
  assert.deepEqual(Object.keys(d), ["windows-x86_64"]);
  assert.deepEqual(resolveDownloadUrls([]), {});
});

test("downloadTargetFor maps OS-plugin output to a release target", () => {
  assert.equal(downloadTargetFor("macos", "aarch64"), "darwin-aarch64");
  assert.equal(downloadTargetFor("macos", "x86_64"), "darwin-x86_64");
  assert.equal(downloadTargetFor("windows", "x86_64"), "windows-x86_64");
  assert.equal(downloadTargetFor("linux", "x86_64"), "linux-x86_64");
  assert.equal(downloadTargetFor("freebsd", "x86_64"), null);
});

test("pickDownloadUrl returns the direct installer for the running platform", () => {
  const status = { downloads: resolveDownloadUrls(ASSETS), url: "u/release-page" };
  assert.equal(pickDownloadUrl(status, "macos", "aarch64"), "u/mac-arm-dmg");
  assert.equal(pickDownloadUrl(status, "windows", "x86_64"), "u/win-msi");
  assert.equal(pickDownloadUrl(status, "linux", "x86_64"), "u/linux-appimage");
});

test("pickDownloadUrl falls back to the release page when no asset matches", () => {
  const status = { downloads: {}, url: "u/release-page" };
  assert.equal(pickDownloadUrl(status, "macos", "aarch64"), "u/release-page");
  // Unsupported OS → release page even when other assets exist.
  const macOnly = { downloads: { "darwin-aarch64": "u/mac-arm-dmg" }, url: "u/release-page" };
  assert.equal(pickDownloadUrl(macOnly, "freebsd", "x86_64"), "u/release-page");
});

test("pickDownloadUrl offers the other mac build on a macOS arch mismatch", () => {
  const armOnly = { downloads: { "darwin-aarch64": "u/mac-arm-dmg" }, url: "u/release-page" };
  // x86_64 report (e.g. under Rosetta) with only an arm build present.
  assert.equal(pickDownloadUrl(armOnly, "macos", "x86_64"), "u/mac-arm-dmg");
});

console.log("app-update.test.ts: ok");
