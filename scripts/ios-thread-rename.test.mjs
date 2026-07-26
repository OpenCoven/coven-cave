import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const rename = await read(`${iosRoot}/Views/ThreadRename.swift`);
const home = await read(`${iosRoot}/Views/ChatsHomeView.swift`);
const familiarThreads = await read(`${iosRoot}/Views/FamiliarThreadsView.swift`);

// Model renames a thread (trim + no-op + persist).
assert.match(
  model,
  /func renameThread\(_ thread: ChatThread, to title: String\) \{[\s\S]*trimmingCharacters[\s\S]*guard !trimmed\.isEmpty, trimmed != thread\.title[\s\S]*target\.title = trimmed[\s\S]*persistThreads\(\)/,
  "AppModel.renameThread should trim, no-op when unchanged, and persist",
);

// Shared rename alert modifier.
assert.match(rename, /struct ThreadRenameModifier: ViewModifier/, "a ThreadRenameModifier should exist");
assert.match(rename, /TextField\("Name", text: \$text\)/, "the rename alert should have a text field");
assert.match(
  rename,
  /func threadRenameAlert\(_ thread: Binding<ChatThread\?>,[\s\S]*onRename: @escaping \(ChatThread, String\) -> Void\) -> some View/,
  "a threadRenameAlert view modifier should be exposed",
);

// Both thread lists wire a Rename context-menu action + the alert.
for (const [name, src] of [["ChatsHomeView", home], ["FamiliarThreadsView", familiarThreads]]) {
  assert.match(src, /renamingThread = thread/, `${name} should set the renaming thread from a menu`);
  assert.match(src, /Label\("Rename", systemImage: "pencil"\)/, `${name} should offer a Rename action`);
  assert.match(
    src,
    /\.threadRenameAlert\(\$renamingThread\) \{ thread, name in app\.renameThread\(thread, to: name\) \}/,
    `${name} should attach the rename alert`,
  );
}

// FamiliarThreadsView only renames on-device threads, not server-only sessions.
assert.match(
  familiarThreads,
  /if case \.local\(let thread\) = entry \{[\s\S]*renamingThread = thread/,
  "FamiliarThreadsView should only rename local threads",
);

console.log("ios-thread-rename.test.mjs: ok");
