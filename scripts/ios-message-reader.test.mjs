import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const messageBubble = read("apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift");
const chatView = read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const runner = read("scripts/run-tests.mjs");

assert.match(
  messageBubble,
  /var onOpenReader: \(\(String\) -> Void\)\? = nil/,
  "MessageBubble should accept an optional reader action",
);

assert.match(
  messageBubble,
  /private var canOpenReader: Bool \{[\s\S]*!isUser[\s\S]*!message\.streaming[\s\S]*!message\.isError[\s\S]*!parsed\.visible\.isEmpty[\s\S]*onOpenReader != nil/,
  "reader action should only be available for settled non-error assistant responses",
);

assert.match(
  messageBubble,
  /Label\("Open in Reader", systemImage: "text\.page"\)/,
  "reader action should be exposed from the message context menu",
);

assert.match(
  messageBubble,
  /\.accessibilityLabel\("Open response in reader"\)/,
  "reader expand button should be directly accessible from the assistant bubble",
);

assert.match(
  chatView,
  /@State private var responseReader: ResponseReaderItem\?/,
  "ChatView should own the presented response reader state",
);

assert.match(
  chatView,
  /onOpenReader: \{ openReader\(text: \$0, familiar: message\.familiarId\.flatMap\(app\.familiar\)\) \}/,
  "ChatView should wire assistant messages into the reader presenter",
);

assert.match(
  chatView,
  /\.sheet\(item: \$responseReader\) \{ item in[\s\S]*ResponseReaderView\(item: item\)/,
  "ChatView should present the response reader as an item sheet",
);

assert.match(
  chatView,
  /struct ResponseReaderView: View[\s\S]*MarkdownWebView\(markdown: item\.markdown, height: \$mdHeight,[\s\S]*scrollable: true/,
  "ResponseReaderView should render the full response through the markdown renderer",
);

assert.match(
  chatView,
  /struct ResponseReaderView: View[\s\S]*Button\("Done"\) \{ dismiss\(\) \}/,
  "ResponseReaderView should provide a Done toolbar action",
);

assert.match(
  chatView,
  /struct ResponseReaderView: View[\s\S]*fontScale[\s\S]*Section\("Theme"\)/,
  "ResponseReaderView should offer reader font-size and theme controls",
);

assert.match(
  runner,
  /"scripts\/ios-message-reader\.test\.mjs"/,
  "mobile test suite should run the response reader coverage",
);

console.log("ios-message-reader.test.mjs: ok");
