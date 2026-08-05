// Pins the iOS accessible-name contract (cave-9s4lv).
//
// A SwiftUI control derives its VoiceOver name from its label. When the label
// renders no text — `label: { EmptyView() }`, or an icon with no title — the
// control still lands in the accessibility tree, just nameless: VoiceOver
// announces "button" and nothing else. That is invisible to every other gate
// we run, because it compiles cleanly and no Xcode test asserts on it.
//
// These are source pins because Swift isn't compiled in CI.
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(root, "apps/ios/CovenCave/CovenCave");

function swiftFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) swiftFiles(full, out);
    else if (entry.name.endsWith(".swift")) out.push(full);
  }
  return out;
}

/// Returns the balanced `{ … }` span starting at `open`, or null if unbalanced.
function braceSpan(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return { body: src.slice(open, i + 1), end: i + 1 };
    }
  }
  return null;
}

/// The modifier chain attached to the control that ends at `from`.
///
/// Comments are dropped rather than counted: a fixed character budget would
/// otherwise let a long explanatory comment push the very modifier being
/// asserted on out of view, which reads as a failure in the code instead of in
/// this parser. The walk stops at the first line that isn't a modifier, so a
/// sibling declaration's modifiers can never be mistaken for this control's.
function trailingModifiers(src, from) {
  const kept = [];
  for (const raw of src.slice(from).split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    if (!line.startsWith(".")) break;
    kept.push(line);
  }
  return kept.join("\n");
}

/// Every `Button { … } label: { … }` in the tree, with the label body and the
/// modifiers that follow it.
function buttonsWithLabelBlocks() {
  const found = [];
  for (const file of swiftFiles(appRoot)) {
    const src = readFileSync(file, "utf8");
    const re = /\bButton\s*\{/g;
    let match;
    while ((match = re.exec(src))) {
      const action = braceSpan(src, src.indexOf("{", match.index));
      if (!action) continue;
      const gap = src.slice(action.end, action.end + 40);
      if (!/^\s*label:\s*\{/.test(gap)) continue;
      const label = braceSpan(src, action.end + gap.indexOf("{"));
      if (!label) continue;
      found.push({
        file: relative(root, file),
        line: src.slice(0, match.index).split("\n").length,
        label: label.body,
        modifiers: trailingModifiers(src, label.end),
      });
    }
  }
  return found;
}

test("no Button ships an EmptyView label without hiding it from assistive tech", () => {
  const offenders = buttonsWithLabelBlocks()
    .filter((b) => /^\{\s*EmptyView\(\)\s*\}$/.test(b.label.replace(/\s+/g, " ").trim()))
    .filter((b) => !/accessibilityHidden\(\s*true\s*\)/.test(b.modifiers))
    .map((b) => `${b.file}:${b.line}`);

  assert.deepEqual(
    offenders,
    [],
    `A Button whose label is EmptyView() has no accessible name — VoiceOver ` +
      `announces a bare "button". Either give it a real label, or, if it exists ` +
      `only to host a keyboard shortcut that duplicates a reachable control, ` +
      `mark it .accessibilityHidden(true). Offenders:\n  ${offenders.join("\n  ")}`,
  );
});

test("the ⌘1–4 destination shortcuts stay out of the accessibility tree", () => {
  const rootView = readFileSync(join(appRoot, "Views/RootView.swift"), "utf8");
  const shortcuts = rootView.slice(rootView.indexOf("AppTab.shortcutOrder"));
  assert.match(
    shortcuts.slice(0, 900),
    /label:\s*\{\s*EmptyView\(\)\s*\}[\s\S]{0,200}?keyboardShortcut[\s\S]{0,600}?accessibilityHidden\(true\)/,
    "RootView's hardware-keyboard tab shortcuts must stay accessibilityHidden — " +
      "they carry no label and duplicate the already-reachable tab bar.",
  );
});

test("controls the session-switch UI tests drive keep their identifiers", () => {
  // SessionSwitchUITests queries these by identifier. Both are Buttons with
  // composed labels, which surface no queryable name on their own, so dropping
  // the identifier silently makes the switcher untestable again (cave-vut6z).
  const chatView = readFileSync(join(appRoot, "Views/ChatView.swift"), "utf8");
  assert.match(chatView, /accessibilityIdentifier\("Switch session"\)/);

  const threads = readFileSync(join(appRoot, "Views/FamiliarThreadsView.swift"), "utf8");
  assert.match(threads, /accessibilityIdentifier\("Thread row \\\(entry\.id\)"\)/);
});
