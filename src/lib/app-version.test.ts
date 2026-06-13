// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const tauriIosConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.ios.conf.json", import.meta.url), "utf8"));
const cargoToml = await readFile(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const sourceIosPlist = await readFile(new URL("../../src-tauri/Info.ios.plist", import.meta.url), "utf8");
const generatedIosPlist = await readFile(new URL("../../src-tauri/gen/apple/app_iOS/Info.plist", import.meta.url), "utf8");
const appVersionSource = await readFile(new URL("./app-version.ts", import.meta.url), "utf8");

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoDescription = cargoToml.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
const cargoAuthors = cargoToml.match(/^authors\s*=\s*\[([^\]]+)\]/m)?.[1] ?? "";
const cargoLicense = cargoToml.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
const cargoRepository = cargoToml.match(/^repository\s*=\s*"([^"]+)"/m)?.[1];
const sourceIosShortVersion = sourceIosPlist.match(
  /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
)?.[1];
const sourceIosBuildVersion = sourceIosPlist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
const generatedIosShortVersion = generatedIosPlist.match(
  /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
)?.[1];
const generatedIosBuildVersion = generatedIosPlist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];

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
assert.equal(sourceIosShortVersion, packageJson.version, "Source iOS plist marketing version must match package.json");
assert.equal(sourceIosBuildVersion, packageJson.version, "Source iOS plist build version must match package.json");
assert.equal(generatedIosShortVersion, packageJson.version, "Generated iOS plist marketing version must match package.json");
assert.equal(generatedIosBuildVersion, packageJson.version, "Generated iOS plist build version must match package.json");
assert.match(
  tauriIosConfig.build.beforeBuildCommand,
  /TAURI_PLATFORM=ios bash scripts\/sidecar-bundle\.sh/,
  "iOS builds must force the mobile sidecar skip",
);
assert.deepEqual(tauriIosConfig.bundle.resources, [], "iOS builds must not bundle the desktop Node sidecar resources");
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
