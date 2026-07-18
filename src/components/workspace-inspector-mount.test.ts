// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /import \{ ChatSurface(?:, [^}]+)? \} from "@\/components\/chat-surface";/,
  "Workspace should import ChatSurface so agent sessions are integrated",
);

assert.match(
  workspace,
  /mode === "chat"[\s\S]*<ChatSurface/,
  "Workspace should mount ChatSurface for the internal chat mode",
);

// The chat inspector sidepanel is retired: the workspace no longer owns a
// rightPanel channel, and ChatSurface no longer takes the familiar-inbox
// wiring the panel's Automations tab consumed.
assert.doesNotMatch(
  workspace,
  /RightPanelKind|setRightPanel|inspectorOpen|setInspectorOpen/,
  "Workspace must not keep any right-panel channel — the inspector sidepanel is retired",
);
assert.doesNotMatch(
  workspace,
  /<ChatSurface[\s\S]{0,2000}?(?:inboxItems=|onOpenInbox=|onCreateReminder=|onOpenInboxItem=|onInboxItemChanged=)/,
  "ChatSurface must not be wired with the retired inspector-inbox props",
);
