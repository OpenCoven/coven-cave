// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargoToml = await readFile(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const appVersionSource = await readFile(new URL("./app-version.ts", import.meta.url), "utf8");

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoDescription = cargoToml.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
const cargoAuthors = cargoToml.match(/^authors\s*=\s*\[([^\]]+)\]/m)?.[1] ?? "";
const cargoLicense = cargoToml.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
const cargoRepository = cargoToml.match(/^repository\s*=\s*"([^"]+)"/m)?.[1];

assert.equal(tauriConfig.version, packageJson.version, "Tauri bundle version must match package.json");
assert.equal(cargoVersion, packageJson.version, "Tauri Cargo package version must match package.json");
assert.equal(
  cargoDescription,
  "Desktop control room for OpenCoven familiars, workflows, memory, and local agent sessions.",
  "Cargo package description must describe CovenCave, not the Tauri template",
);
assert.match(cargoAuthors, /OpenCoven contributors/, "Cargo package authors must name OpenCoven contributors");
assert.equal(cargoLicense, "MIT OR AGPL-3.0-only", "Cargo package license must match the repository dual-license offer");
assert.equal(cargoRepository, "https://github.com/OpenCoven/coven-cave", "Cargo package repository must point at Coven Cave");
assert.equal(packageJson.description, cargoDescription, "package.json and Cargo descriptions must match");
assert.equal(packageJson.license, cargoLicense, "package.json and Cargo licenses must match");
assert.equal(tauriConfig.bundle.publisher, "OpenCoven", "Tauri bundle publisher must be OpenCoven");
assert.equal(tauriConfig.bundle.license, cargoLicense, "Tauri bundle license must match Cargo license");
assert.equal(tauriConfig.bundle.licenseFile, "../LICENSE", "Tauri bundle must include the repository license notice");
assert.equal(tauriConfig.bundle.category, "DeveloperTool", "Tauri bundle category must identify CovenCave as a developer tool");
assert.match(
  tauriConfig.bundle.longDescription,
  /OpenCoven desktop control room/,
  "Tauri bundle long description must explain the app's purpose",
);
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
