import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const githubView = read("apps/ios/CovenCave/CovenCave/Views/GitHubView.swift");
const runner = read("scripts/run-tests.mjs");

// The "tag a familiar" affordance is gone entirely.
assert.doesNotMatch(
  githubView,
  /tag a familiar|Tag familiar|insertMention/,
  "the GitHub comment composer should no longer offer familiar tagging",
);

// The composer emulates GitHub's "Paste, drop, or click to add files" bar via a
// PhotosPicker.
assert.match(
  githubView,
  /import PhotosUI/,
  "GitHubView should import PhotosUI for the attachment picker",
);

assert.match(
  githubView,
  /PhotosPicker\(selection: \$photoItems, maxSelectionCount: \d+, matching: \.images\)/,
  "the attach-files bar should be a PhotosPicker over images",
);

assert.match(
  githubView,
  /Text\("Paste, drop, or click to add files"\)/,
  "the composer should surface GitHub's add-files affordance copy",
);

// Picking an image inserts a GitHub markdown image placeholder into the body.
assert.match(
  githubView,
  /private func insertImageMarkdown\(named name: String\)[\s\S]*!\[\\\(name\)\]\(url\)/,
  "attaching an image should insert a markdown image placeholder into the draft",
);

// Attachments are tracked as removable chips and cleared after a successful post.
assert.match(
  githubView,
  /struct CommentAttachment: Identifiable/,
  "attachments should be modeled so they can render as chips",
);

assert.match(
  githubView,
  /attachments = \[\][\s\S]*await load\(\)/,
  "a successful comment post should clear pending attachments",
);

assert.match(
  runner,
  /"scripts\/ios-github-comment-attach\.test\.mjs"/,
  "mobile test suite should run the GitHub comment attachment coverage",
);

console.log("ios-github-comment-attach.test.mjs: ok");
