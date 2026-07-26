import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const parser = await read(`${iosRoot}/Views/ThreadImport.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const newChat = await read(`${iosRoot}/Views/NewChatView.swift`);

// Parser pulls title, participants, and **Author**-delimited turns.
assert.match(parser, /func parseThreadMarkdown\(_ text: String\) -> ParsedThread/, "a parser should exist");
assert.match(parser, /struct Turn \{ let who: String; let text: String \}/, "turns carry author + text");
assert.match(parser, /trimmed\.hasPrefix\("# "\)/, "parses the title");
assert.match(parser, /trimmed\.hasPrefix\("_Chat with "\)/, "parses the participant line");
assert.match(parser, /trimmed\.hasPrefix\("\*\*"\), trimmed\.hasSuffix\("\*\*"\)/, "detects author headers");

// Model maps turns to roles and resolves familiars by name.
assert.match(model, /func importMarkdown\(_ text: String, fallbackTitle: String = "Imported chat"\) -> ChatThread/, "AppModel should import Markdown");
assert.match(model, /case "you":\s*messages\.append\(DisplayMessage\(role: \.user/, "You maps to a user turn");
assert.match(model, /case "system":\s*messages\.append\(DisplayMessage\(role: \.system/, "System maps to a system turn");
assert.match(model, /displayName\.caseInsensitiveCompare\(name\) == \.orderedSame/, "resolves a familiar by display name");
assert.match(model, /threads\.insert\(thread, at: 0\)\s*persistThreads\(\)/, "inserts and persists the imported thread");

// NewChatView offers a file importer wired to importMarkdown.
assert.match(newChat, /import UniformTypeIdentifiers/, "imports UTType");
assert.match(newChat, /\.fileImporter\(isPresented: \$importingFile/, "presents a file importer");
assert.match(newChat, /Label\("Import from Markdown…", systemImage: "square\.and\.arrow\.down"\)/, "shows an Import action");
assert.match(newChat, /onStart\(app\.importMarkdown\(text, fallbackTitle: fallback\)\)/, "imports then opens the thread");
assert.match(newChat, /startAccessingSecurityScopedResource\(\)/, "accesses the security-scoped file");

console.log("ios-import-markdown.test.mjs: ok");
