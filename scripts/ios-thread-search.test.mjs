import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const iosViews = new URL("../apps/ios/CovenCave/CovenCave/Views/", import.meta.url);
const home = await readFile(new URL("ChatsHomeView.swift", iosViews), "utf8");
const picker = await readFile(new URL("FamiliarThreadsView.swift", iosViews), "utf8");

// Thread search lives in the session picker: the Chats home is a list of
// familiars now, so finding a conversation by what was said in it has to
// happen where you choose the conversation.
assert.match(picker, /@State private var query = ""/, "the picker should hold a search query");
assert.match(
  picker,
  /\.searchable\(text: \$query/,
  "the picker should expose the query through the platform search field",
);

// The rows the picker renders come from `entries`; the query narrows them, with
// the per-thread rules in `matches`. Assert inside those two bodies only, so an
// unrelated construct elsewhere in the file can never satisfy a claim.
const entriesBody = picker.match(/private var entries: \[Entry\] \{\n([\s\S]*?)\n    \}\n/);
assert.ok(entriesBody, "the picker should derive its rows from an `entries` computed property");
const matchesBody = picker.match(
  /private func matches\(_ thread: ChatThread, query q: String\) -> Bool \{\n([\s\S]*?)\n    \}\n/,
);
assert.ok(matchesBody, "the picker should decide per-thread matches in a `matches` helper");
const search = `${entriesBody[1]}\n${matchesBody[1]}`;

assert.match(
  search,
  /let q = query\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\.lowercased\(\)/,
  "the query should be trimmed and case-folded before matching",
);
assert.match(search, /thread\.title\.lowercased\(\)\.contains\(q\)/, "should match by thread title");
assert.match(
  search,
  /familiarIds[\s\S]{0,160}?\$0\.displayName\.lowercased\(\)\.contains\(q\)/,
  "should match by a member's name",
);
assert.match(
  search,
  /thread\.messages\.contains \{ \$0\.text\.lowercased\(\)\.contains\(q\) \}/,
  "should match by message text",
);
assert.match(
  search,
  /\.filter \{ showArchived \|\| !\$0\.archived \}/,
  "should search non-archived threads unless archived are shown",
);
assert.match(search, /if q\.isEmpty \{ return true \}/, "an empty query should return every thread");

// Server-only sessions have no on-device transcript, so they match on title.
assert.match(
  search,
  /serverOnlySessions\(for: familiar\.id\)[\s\S]{0,200}?q\.isEmpty \|\| \$0\.title\.lowercased\(\)\.contains\(q\)/,
  "server-only sessions should be searched by title",
);

// Tapping a result opens that conversation.
assert.match(
  picker,
  /ForEach\(entries\) \{ entry in[\s\S]{0,200}?tapEntry\(entry\)/,
  "results should open the thread when tapped",
);

// What survives on the home is familiar filtering — the home is a familiar list.
assert.match(home, /private var filteredFamiliars: \[Familiar\]/, "the home should filter familiars");
assert.match(
  home,
  /filteredFamiliars\.isEmpty/,
  "the home's search empty-state should consider matching familiars",
);

console.log("ios-thread-search.test.mjs: ok");
