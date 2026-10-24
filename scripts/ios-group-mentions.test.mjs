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

// One-to-one chats with a project mention files (#6104), ported from the
// desktop's src/lib/file-mention.ts and sent the way CHAT-D1-04 sends them.
assert.match(
  input,
  /guard !partial\.contains\("@"\) else \{ return nil \}/,
  "a second @ ends a mention, like the desktop's fileMentionToken",
);
const fileMention = await read("Models/FileMention.swift");
assert.match(fileMention, /enum FileMention \{/, "the FileMention helper should exist");
assert.match(
  fileMention,
  /if base\.hasPrefix\(q\) \{ rank = 0 \}[\s\S]*base\.contains\(q\) \{ rank = 1 \}[\s\S]*path\.contains\(q\) \{ rank = 2 \}[\s\S]*isSubsequence\(q, of: path\) \{ rank = 3 \}/,
  "file ranking follows the desktop: name prefix, name, path, then subsequence",
);
assert.match(fileMention, /static let maxPerSend = 10/, "at most ten mentions go with a send, as on the desktop and server");
assert.match(
  chat,
  /private var fileMentionRoot: String\? \{\s*guard !thread\.isGroup, !thread\.isFlowRun,\s*let root = thread\.projectRoot/,
  "file mentions are for one-to-one chats with a project",
);
assert.match(chat, /files: fileMentionMatches\)/, "the suggestion menu carries the file matches");
assert.match(
  chat,
  /case \.file\(let path\):\s*draft = MentionInput\.insert\(name: path, into: draft\)/,
  "picking a file inserts its repo-relative path",
);
const client = await read("Networking/CaveClient.swift");
assert.match(
  client,
  /request\(\s*"api\/project\/files\?root=\\\(Self\.queryValue\(root\)\)&familiarId=/,
  "the file index comes from the desktop picker's route, with a strictly encoded root",
);
assert.match(client, /var mentionedFiles: \[String\]\? = nil\s*var mentionedFilesRoot: String\? = nil/,
  "the send body carries mentions and their root");
const thread = await read("State/ChatThread.swift");
assert.match(
  thread,
  /if !isGroup, let projectRoot \{\s*let mentioned = FileMention\.paths\(in: prompt\)[\s\S]{0,160}body\.mentionedFiles = mentioned\s*body\.mentionedFilesRoot = projectRoot/,
  "makeSendBody reads mentions from the prompt, so retry and queued replay carry them too",
);

console.log("ios-group-mentions: ok");
