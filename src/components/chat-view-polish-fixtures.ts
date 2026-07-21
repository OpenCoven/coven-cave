// @ts-nocheck
import { readFileSync } from "node:fs";

export const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
export const sessionHeader = readFileSync(new URL("./chat-session-header.tsx", import.meta.url), "utf8");
export const attachmentCards = readFileSync(new URL("./chat-attachment-cards.tsx", import.meta.url), "utf8");
export const emptyStateSource = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
export const styles = [
  "cave-md",
  "cave-composer",
  "chat-list",
  "calendar",
  "cave-chat",
  "cave-chat/bubbles",
  "cave-chat/activity",
  "cave-chat/transcript",
  "cave-chat/auxiliary-surfaces",
]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
export const globalsSrc = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
export const chatDebugStoreSource = readFileSync(new URL("../lib/chat-debug-store.ts", import.meta.url), "utf8");
export const attachmentsLib = readFileSync(new URL("../lib/chat-attachments.ts", import.meta.url), "utf8");
export const attachStagingHook = readFileSync(new URL("../lib/use-attachment-staging.ts", import.meta.url), "utf8");
export const menusHookSource = readFileSync(new URL("../lib/use-inline-slash-menus.ts", import.meta.url), "utf8");
export const mentionAttachmentSource = readFileSync(
  new URL("../app/api/chat/send/chat-send-attachments.ts", import.meta.url),
  "utf8",
);
export const chatRuntimeSource = readFileSync(
  new URL("../app/api/chat/send/chat-send-runtime.ts", import.meta.url),
  "utf8",
);
export const turnRow = source.match(/function TurnRowImpl[\s\S]*?\n}\n\ntype TurnRowProps/)?.[0] ?? "";
export const splitReasoning = source.match(/function splitReasoning[\s\S]*?\n}\n\n\/\/ ── ChatEmptyState/)?.[0] ?? "";
