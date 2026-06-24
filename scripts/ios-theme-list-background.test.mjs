import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../apps/ios/CovenCave/CovenCave/${p}`, import.meta.url), "utf8");

const theme = await read("Theme/Theme.swift");

// The reusable modifier reveals the desktop theme's bgBase behind a List instead
// of the opaque system background: hide the scroll content background AND paint
// bgBase from the chrome palette.
assert.match(
  theme,
  /struct ThemedListBackground: ViewModifier \{[\s\S]*@Environment\(\\\.chrome\)[\s\S]*\.scrollContentBackground\(\.hidden\)[\s\S]*\.background\(chrome\.bgBase\)/,
  "Theme should define a ThemedListBackground modifier that hides the system list fill and paints chrome.bgBase",
);
assert.match(
  theme,
  /func themedListBackground\(\) -> some View \{ modifier\(ThemedListBackground\(\)\) \}/,
  "Theme should expose the themedListBackground() View extension",
);

// Every primary plain browse list adopts it after its listStyle so the themed
// background shows through.
for (const view of [
  "ChatsHomeView.swift",
  "FamiliarThreadsView.swift",
  "RemindersView.swift",
]) {
  const src = await read(`Views/${view}`);
  assert.match(
    src,
    /\.listStyle\(\.plain\)\s*\n\s*\.themedListBackground\(\)/,
    `${view} should apply .themedListBackground() right after .listStyle(.plain)`,
  );
}

// Inset-grouped surfaces adopt the same modifier (the themed bgBase floor shows
// behind the cards), applied after .listStyle(.insetGrouped).
for (const view of ["TasksView.swift", "GitHubView.swift", "CodeBrowserView.swift"]) {
  const src = await read(`Views/${view}`);
  assert.match(
    src,
    /\.listStyle\(\.insetGrouped\)\s*\n\s*\.themedListBackground\(\)/,
    `${view} should apply .themedListBackground() right after .listStyle(.insetGrouped)`,
  );
}

// Theme.swift exposes the sheet-background modifier (presentationBackground).
assert.match(
  theme,
  /struct ThemedSheetBackground: ViewModifier \{[\s\S]*@Environment\(\\\.chrome\)[\s\S]*\.presentationBackground\(chrome\.bgBase\)/,
  "Theme should define a ThemedSheetBackground modifier that themes the sheet's presentation surface",
);
assert.match(
  theme,
  /func themedSheetBackground\(\) -> some View \{ modifier\(ThemedSheetBackground\(\)\) \}/,
  "Theme should expose the themedSheetBackground() View extension",
);

// Modal sheets theme both their list and their presentation background.
for (const view of [
  "CommandsSheet.swift",
  "LinkedTasksSheet.swift",
  "NewChatView.swift",
  "ChatModelControl.swift",
]) {
  const src = await read(`Views/${view}`);
  assert.match(src, /\.themedListBackground\(\)/, `${view} should theme its list`);
  assert.match(src, /\.themedSheetBackground\(\)/, `${view} should theme its sheet presentation background`);
}

// The chat transcript (a ScrollView, not a List) paints bgBase directly so the
// bubbles float on the themed floor instead of the system navigation background.
{
  const chat = await read("Views/ChatView.swift");
  assert.match(chat, /@Environment\(\\\.chrome\) private var chrome/, "ChatView should read the chrome palette");
  assert.match(
    chat,
    /\.background\(chrome\.bgBase\.ignoresSafeArea\(\)\)/,
    "ChatView should paint chrome.bgBase behind the transcript",
  );
}

console.log("ios-theme-list-background: ok");
