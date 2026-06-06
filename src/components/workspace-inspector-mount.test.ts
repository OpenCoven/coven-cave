// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /import \{ InspectorPane \} from "@\/components\/inspector-pane";/,
  "Workspace should import InspectorPane so the right-pane tabs are reachable",
);

assert.match(
  workspace,
  /<InspectorPane\s+familiar=\{active\}\s+inboxItems=\{inboxItemsWithEphemeral\}\s+onOpenInbox=\{\(\) => setMode\("inbox"\)\}\s+\/>/,
  "Chats mode should mount InspectorPane with the active familiar and inbox items",
);
