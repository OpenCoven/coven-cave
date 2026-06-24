import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const developerView = read("apps/ios/CovenCave/CovenCave/Views/DeveloperView.swift");
const codeBrowserView = read("apps/ios/CovenCave/CovenCave/Views/CodeBrowserView.swift");

assert.match(
  developerView,
  /case \.code: return "Code"/,
  "the Development tab selector should keep the Code section label",
);

assert.doesNotMatch(
  codeBrowserView,
  /\.navigationTitle\("Code"\)/,
  "CodeBrowserView should not add a duplicate Code navigation title inside Development",
);

console.log("ios-development-code-title.test.mjs: ok");
