// @ts-nocheck
import { readFileSync } from "node:fs";

export const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
export const emptyStateSource = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
export const styles = ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
export const globalsSrc = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
export const attachmentsLib = readFileSync(new URL("../lib/chat-attachments.ts", import.meta.url), "utf8");
export const attachStagingHook = readFileSync(new URL("../lib/use-attachment-staging.ts", import.meta.url), "utf8");
export const menusHookSource = readFileSync(new URL("../lib/use-inline-slash-menus.ts", import.meta.url), "utf8");
export const turnRow = source.match(/function TurnRowImpl[\s\S]*?\n}\n\ntype TurnRowProps/)?.[0] ?? "";
export const splitReasoning = source.match(/function splitReasoning[\s\S]*?\n}\n\n\/\/ ── ChatEmptyState/)?.[0] ?? "";
