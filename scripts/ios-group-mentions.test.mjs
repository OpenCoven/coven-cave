import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = "../apps/ios/CovenCave/CovenCave";
const read = (p) => readFile(new URL(`${base}/${p}`, import.meta.url), "utf8");

// Pure mention detection/insertion helper.
const input = await read("Models/MentionInput.swift");
assert.match(input, /enum MentionInput \{/, "MentionInput helper should exist");
assert.match(
  input,
  /static func partial\(_ draft: String\) -> String\? \{[\s\S]*token\.hasPrefix\("@"\)[\s\S]*token\.dropFirst\(\)/,
  "partial() should return the text after a trailing @",
);
assert.match(
  input,
  /static func insert\(name: String, into draft: String\) -> String \{[\s\S]*"@\\\(name\) "/,
  "insert() should replace the trailing @token with @<name> ",
);

// Mentions render in the composer's one suggestion menu (#5879).
const menu = await read("Views/SuggestionMenu.swift");
assert.match(menu, /struct SuggestionMenu: View/, "the suggestion menu view should exist");
assert.match(menu, /AvatarView\(familiar: familiar/, "familiar rows (mentions) should show avatars");
const list = await read("Models/ComposerSuggestionList.swift");
assert.match(list, /case \.mention:[\s\S]{0,400}title: "@\\\(\$0\.displayName\)"/, "mention rows read @<name>");

// ChatView wires the mention menu, group-only, off the trailing @token.
const chat = await read("Views/ChatView.swift");
assert.match(
  chat,
  /private var mentionMatches: \[Familiar\] \{[\s\S]*thread\.isGroup[\s\S]*MentionInput\.partial\(draft\)/,
  "mentionMatches should be group-only and driven by MentionInput",
);
assert.match(chat, /mentions: showingMentionMenu \? mentionMatches : \[\]/, "the suggestion menu carries the mention matches");
assert.match(
  chat,
  /draft = MentionInput\.insert\(name: familiar\.displayName, into: draft\)/,
  "picking a familiar should insert the mention into the draft",
);

console.log("ios-group-mentions: ok");
