import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const exportFile = await read(`${iosRoot}/Views/ThreadExport.swift`);
const chat = await read(`${iosRoot}/Views/ChatView.swift`);

// Markdown renderer attributes each turn and titles the doc.
assert.match(model, /func exportMarkdown\(_ thread: ChatThread\) -> String/, "AppModel should render a thread to Markdown");
assert.match(model, /lines: \[String\] = \["# \\\(thread\.title\)", ""\]/, "export should title the document");
assert.match(model, /case \.user: who = "You"/, "user turns attributed to You");
assert.match(model, /case \.assistant: who = message\.familiarId\.flatMap \{ familiar\(\$0\)\?\.displayName \} \?\? "Assistant"/, "assistant turns attributed to the familiar");
assert.match(model, /if text\.isEmpty \{ continue \}/, "empty/streaming turns are skipped");

// Transferable exports a .md file lazily.
assert.match(exportFile, /struct ThreadMarkdownExport: Transferable/, "a Transferable export type should exist");
assert.match(exportFile, /DataRepresentation\(exportedContentType: \.plainText\)/, "should export as data");
assert.match(exportFile, /\.suggestedFileName \{ export in "\\\(export\.fileBaseName\)\.md" \}/, "should suggest a .md filename");

// ChatView wires a share button to the export.
assert.match(
  chat,
  /ShareLink\(item: ThreadMarkdownExport\(title: thread\.title,\s*markdown: app\.exportMarkdown\(thread\)\)/,
  "ChatView should offer a ShareLink for the Markdown export",
);
assert.match(chat, /\.accessibilityLabel\("Export as Markdown"\)/, "the export button should be labelled");

console.log("ios-export-markdown.test.mjs: ok");
