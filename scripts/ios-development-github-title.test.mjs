import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const developerView = read("apps/ios/CovenCave/CovenCave/Views/DeveloperView.swift");
const githubView = read("apps/ios/CovenCave/CovenCave/Views/GitHubView.swift");

assert.match(
  developerView,
  /case \.github: return "GitHub"/,
  "the Development tab selector should keep the GitHub section label",
);

assert.doesNotMatch(
  githubView,
  /\.navigationTitle\("GitHub"\)/,
  "GitHubView should not add a duplicate GitHub navigation title inside Development",
);

console.log("ios-development-github-title.test.mjs: ok");
