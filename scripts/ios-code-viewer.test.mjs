import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const editor = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/CodeEditorView.swift", import.meta.url),
  "utf8",
);
const browser = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/CodeBrowserView.swift", import.meta.url),
  "utf8",
);
const route = await readFile(new URL("../src/app/api/project-file/route.ts", import.meta.url), "utf8");

assert.match(
  editor,
  /MarkdownWebView\(markdown: previewMarkdown\(for: loaded\)/,
  "iOS code preview should route through previewMarkdown",
);
assert.match(
  editor,
  /private func isMarkdownDocument[\s\S]*case "md", "markdown", "mdx": return true/,
  "iOS code preview should treat Markdown files as documents",
);
assert.match(
  editor,
  /case "txt", "text", "log", "out", "err", "trace": return "text"/,
  "iOS code preview should render log-style extensions as text code fences",
);
assert.match(
  browser,
  /case "md", "markdown", "mdx":[\s\S]*return "doc\.richtext"/,
  "iOS code browser should use a rich text icon for Markdown",
);
assert.match(
  browser,
  /case "txt", "text", "log", "out", "err", "trace":[\s\S]*return "doc\.plaintext"/,
  "iOS code browser should use a plain text icon for log-style text",
);
assert.match(
  browser,
  /case "diff", "patch":[\s\S]*return "plusminus"/,
  "iOS code browser should identify diff-like files",
);
assert.match(
  route,
  /"\.markdown",[\s\S]*?"\.log",[\s\S]*?"\.out",[\s\S]*?"\.err",[\s\S]*?"\.trace"/,
  "project-file API should allow Markdown aliases and log-style text extensions",
);

console.log("ios-code-viewer.test.mjs: ok");
