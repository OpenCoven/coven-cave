// @ts-nocheck
//
// Guard (#6560): a Board task chat refused with 409 project_root_unconfirmed
// offers Confirm folder in the banner. It confirms the project the server
// named, through useProjects().confirmRoot (the settings route and its Touch ID
// ceremony), and re-runs the task chat only after a confirmed folder.
// Source-string assertions, like harness-fix-actions.test.ts.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const board = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");

assert.match(
  board,
  /const \{ projects, confirmRoot \} = useProjects\(\);/,
  "Board should confirm through the shared projects hook",
);
assert.match(
  board,
  /const folderProjectId = refusedUnconfirmedProjectId\(json\);\s*setChatLinkFolderConfirm\(folderProjectId \? \{ message, projectId: folderProjectId \} : null\);\s*throw new Error\(message\);/,
  "only a server-named unconfirmed project becomes a confirm target, tied to that message",
);

const handlerIndex = board.indexOf("const confirmTaskFolderAndRetry = async");
assert.ok(handlerIndex > 0, "Board should have an in-place Confirm folder handler");
const handler = board.slice(handlerIndex, board.indexOf("\n  };\n", handlerIndex));
assert.match(handler, /target\.message !== chatLinkError/, "a different, later error never inherits the action");
assert.match(handler, /await confirmRoot\(target\.projectId\)/, "the confirmation targets the server-named project");
assert.match(
  handler,
  /if \(!result\.ok\) \{[\s\S]*setChatLinkError\(result\.error\);[\s\S]*return;[\s\S]*\}[\s\S]*await openTaskWork\(id\);/,
  "a declined or unavailable confirmation shows the server's message and never re-runs the task chat",
);

assert.match(
  board,
  /\{chatLinkConfirmsFolder \? \([\s\S]{0,300}loading=\{confirmingTaskFolder\}[\s\S]{0,200}onClick=\{\(\) => void confirmTaskFolderAndRetry\(\)\}[\s\S]{0,80}Confirm folder/,
  "the banner renders Confirm folder only for a confirmable refusal",
);
