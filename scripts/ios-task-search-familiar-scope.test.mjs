import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const sheet = await read(`${iosRoot}/Views/LinkedTasksSheet.swift`);

// When searching tasks to assign from within a chat, the list is scoped to the
// chat's familiar(s) or unassigned tasks — another familiar's tasks never show.
assert.match(
  sheet,
  /let chatFamiliars = Set\(thread\.familiarIds\)/,
  "assignable should derive the chat's familiar set from the thread",
);
assert.match(
  sheet,
  /let owner = card\.familiarId/,
  "assignable should read each card's owning familiar",
);
assert.match(
  sheet,
  /let belongsHere = owner == nil \|\| owner!\.isEmpty \|\| chatFamiliars\.contains\(owner!\)/,
  "a task is assignable only when unassigned or owned by one of the chat's familiars",
);
assert.match(
  sheet,
  /guard belongsHere else \{ return false \}/,
  "tasks belonging to a different familiar are filtered out before the text match",
);
// The text-search match still applies on top of the familiar scope.
assert.match(
  sheet,
  /return q\.isEmpty \|\| card\.title\.lowercased\(\)\.contains\(q\)/,
  "the search query still filters within the familiar-scoped set",
);

console.log("ios-task-search-familiar-scope.test.mjs: ok");
