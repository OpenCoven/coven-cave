// @ts-nocheck
// Chat rows can be deleted from the Chats page, and deletion always goes
// through an explicit inline confirmation (no single-click destruction).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");

assert.match(
  list,
  /aria-label=\{`Delete chat \$\{s\.title \|\| s\.id\}`\}/,
  "Each chat row exposes a labeled delete button",
);

assert.match(
  list,
  /setConfirmDeleteId\(s\.id\)/,
  "First click only ARMS the confirmation — it must not delete",
);

assert.match(
  list,
  /Delete chat\?[\s\S]*?Cancel[\s\S]*?Confirm delete chat/,
  "Inline confirmation offers explicit Cancel and Delete actions",
);

assert.match(
  list,
  /const deleteSession = async[\s\S]*?fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`, \{ method: "DELETE" \}\)/,
  "Confirmed delete calls DELETE /api/sessions/:id (contract-backed endpoint)",
);

assert.match(
  list,
  /setActiveId\(\(current\) => \(current === sessionId \? null : current\)\)/,
  "Deleting the active chat clears the local active selection",
);

assert.match(
  list,
  /onSessionsChanged\?\.\(\);/,
  "Successful delete refreshes the session list via the workspace callback",
);

assert.match(
  list,
  /e\.stopPropagation\(\); setConfirmDeleteId\(s\.id\)/,
  "Delete button does not open the chat row it sits on",
);

assert.match(
  list,
  /setError\(json\.error \?\? "delete failed"\)/,
  "Delete failures surface in the existing error banner",
);

assert.match(
  router,
  /onSessionsChanged=\{onSessionsChanged\}[\s\S]*?onOpen=\{\(sessionId, familiarId\)/,
  "ChatRouter threads onSessionsChanged into ChatList",
);

console.log("chat-list-delete.test.ts: ok");
