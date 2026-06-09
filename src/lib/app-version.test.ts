// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargoToml = await readFile(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const appVersionSource = await readFile(new URL("./app-version.ts", import.meta.url), "utf8");

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

assert.equal(tauriConfig.version, packageJson.version, "Tauri bundle version must match package.json");
assert.equal(cargoVersion, packageJson.version, "Tauri Cargo package version must match package.json");
assert.match(
  appVersionSource,
  /from "\.\.\/\.\.\/package\.json"/,
  "App-reported version must be sourced from package.json",
);
assert.match(
  appVersionSource,
  /export const APP_VERSION/,
  "App version module must export APP_VERSION for UI reporting",
);

console.log("app-version.test.ts: ok");
