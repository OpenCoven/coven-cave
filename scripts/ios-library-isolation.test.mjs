import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const client = read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const developerView = read("apps/ios/CovenCave/CovenCave/Views/DeveloperView.swift");
const slashCommand = read("apps/ios/CovenCave/CovenCave/Models/SlashCommand.swift");
const runner = read("scripts/run-tests.mjs");

assert.equal(
  exists("apps/ios/CovenCave/CovenCave/Views/LibraryView.swift"),
  false,
  "native LibraryView should live only on feature/library while Library is isolated",
);
assert.equal(
  exists("apps/ios/CovenCave/CovenCave/Models/LibraryItem.swift"),
  false,
  "native LibraryItem models should live only on feature/library while Library is isolated",
);

assert.doesNotMatch(
  client,
  /api\/library|func routeLink\(|func libraryReading\(|func libraryBookmarks\(|RouteLinkBody|RouteLinkResult|LibraryItem/,
  "integrated CaveClient should not expose Library API calls",
);
assert.doesNotMatch(
  developerView,
  /LibraryView|case \.library|Library"/,
  "Development tabs should not expose native Library while it lives on feature/library",
);
assert.doesNotMatch(
  slashCommand,
  /case saveLink|\/save|\/research|parseSaveArgs|SlashSaveArgs/,
  "native slash catalog should not expose Library save/research commands",
);
assert.match(
  runner,
  /scripts\/ios-library-isolation\.test\.mjs/,
  "iOS Library isolation guard should be wired into the mobile suite",
);

console.log("ios-library-isolation.test.mjs: ok");
