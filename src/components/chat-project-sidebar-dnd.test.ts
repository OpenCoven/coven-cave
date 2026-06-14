// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");

// Folder tree is a DnD surface: each folder is a drop zone, each chat sortable.
assert.match(src, /useDroppable/, "project folders are drop zones");
assert.match(src, /function FolderDroppable/, "folder droppable wrapper exists");
assert.match(src, /function FolderChatRow/, "folder chats are sortable rows");
assert.match(src, /id=\{`folder:\$\{key\}`\}/, "folder droppable id encodes the selection key");

// One DndContext wraps the folder map with the folder drag handler.
assert.match(
  src,
  /<DndContext[\s\S]{0,80}onDragEnd=\{handleFolderDragEnd\}>[\s\S]{0,200}groups\.map/,
  "the folder tree map is wrapped in a DndContext using the folder drag handler",
);

// Reorder within a folder reuses the shared manual-order list.
assert.match(src, /function handleFolderDragEnd/, "folder drag handler exists");
assert.match(src, /mergeVisibleOrder[\s\S]{0,120}writeSessionOrder/, "same-folder drop reorders via the manual order");

// Cross-folder drop moves via the Cave-local override (never touches cwd).
assert.match(src, /setProjectOverride\(activeId, target\.projectRoot \?\? ""\)/, "cross-folder drop sets a project override");

// Chats render in manual order inside each folder.
assert.match(src, /applyManualOrder\(group\.sessions, order\)/, "folder chats honor the manual order");

console.log("chat-project-sidebar-dnd.test.ts: ok");
