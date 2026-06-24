// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const mode = readFileSync(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");

test("GroupChatView broadcasts via /api/chat/send and reuses pure helpers", () => {
  assert.match(view, /export function GroupChatView/, "exports GroupChatView");
  // Fan-out: one /api/chat/send per participant carrying the per-familiar id.
  assert.match(view, /fetch\("\/api\/chat\/send"/, "sends through the chat bridge");
  assert.match(view, /familiarId: reply\.familiarId/, "each stream targets one familiar");
  assert.match(view, /Promise\.all\(replies\.map/, "fans out to every participant in parallel");
  // Reuses the tested pure reducers rather than re-parsing inline.
  assert.match(view, /applyGroupEvent|parseSseBuffer/, "uses the pure stream reducers");
  // Per-familiar session pinning so each thread resumes.
  assert.match(view, /recordSession\(group\.id, reply\.familiarId/, "pins each familiar's session id");
  // A Stop control aborts the in-flight broadcast.
  assert.match(view, /abortRef\.current\?\.abort\(\)/, "Stop aborts the broadcast");
});

test("Group Chat is wired into navigation", () => {
  assert.match(mode, /\| "groupchat"/, "groupchat is a valid WorkspaceMode");
  assert.match(sidebar, /id: "groupchat", label: "Group"/, "sidebar exposes the Group surface");
  assert.match(workspace, /groupchat: "Group Chat"/, "groupchat mode has a title");
  assert.match(
    workspace,
    /mode === "groupchat" \?\s*\(\s*<GroupChatView/,
    "workspace renders GroupChatView for the groupchat mode",
  );
  assert.match(
    workspace,
    /import \{ GroupChatView \} from "@\/components\/group-chat-view"/,
    "workspace imports GroupChatView",
  );
});
