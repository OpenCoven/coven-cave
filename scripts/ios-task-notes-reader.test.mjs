import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const taskDetail = read("apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift");
const runner = read("scripts/run-tests.mjs");

assert.match(
  taskDetail,
  /MarkdownWebView\(markdown: notes, height: \$notesHeight\)/,
  "Task notes should render through the markdown renderer, not plain Text",
);

assert.doesNotMatch(
  taskDetail,
  /Text\(notes\)/,
  "the plain-text notes fallback should be gone in favor of markdown",
);

assert.match(
  taskDetail,
  /@State private var notesReader: ResponseReaderItem\?/,
  "TaskDetailView should own the presented notes reader state",
);

assert.match(
  taskDetail,
  /notesReader = ResponseReaderItem\(title: "Notes", markdown: notes\)/,
  "the expand affordance should wire the notes into the reader presenter",
);

assert.match(
  taskDetail,
  /\.accessibilityLabel\("Open notes in reader"\)/,
  "the notes reader expand button should be accessible",
);

assert.match(
  taskDetail,
  /\.sheet\(item: \$notesReader\) \{ item in[\s\S]*ResponseReaderView\(item: item\)/,
  "TaskDetailView should present the shared response reader for notes",
);

assert.match(
  runner,
  /"scripts\/ios-task-notes-reader\.test\.mjs"/,
  "mobile test suite should run the task notes reader coverage",
);

console.log("ios-task-notes-reader.test.mjs: ok");
