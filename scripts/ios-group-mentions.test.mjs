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

// A picker view exists.
const menu = await read("Views/MentionMenu.swift");
assert.match(menu, /struct MentionMenu: View/, "MentionMenu view should exist");
assert.match(menu, /AvatarView\(familiar: familiar/, "MentionMenu rows should show avatars");

// ChatView wires the mention menu, group-only, off the trailing @token.
const chat = await read("Views/ChatView.swift");
assert.match(
  chat,
  /private var mentionMatches: \[Familiar\] \{[\s\S]*thread\.isGroup[\s\S]*MentionInput\.partial\(draft\)/,
  "mentionMatches should be group-only and driven by MentionInput",
);
assert.match(chat, /if showingMentionMenu \{[\s\S]*MentionMenu\(familiars: mentionMatches/, "the composer should show the mention menu");
assert.match(
  chat,
  /draft = MentionInput\.insert\(name: familiar\.displayName, into: draft\)/,
  "picking a familiar should insert the mention into the draft",
);

console.log("ios-group-mentions: ok");
