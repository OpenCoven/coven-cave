// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /import \{ ChatSurface \} from "@\/components\/chat-surface";/,
  "Workspace should import ChatSurface so agent sessions and the inspector are integrated",
);

assert.match(
  workspace,
  /<ChatSurface[\s\S]*inboxItems=\{inboxItemsWithEphemeral\}[\s\S]*onOpenInbox=\{\(\) => setMode\("schedules"\)\}[\s\S]*onCreateReminder=\{openReminderForFamiliar\}[\s\S]*onOpenInboxItem=\{openInspectorInboxItem\}[\s\S]*onInboxItemChanged=\{refreshInbox\}/,
  "Chat mode should mount ChatSurface with fully wired familiar Inbox controls",
);

assert.match(
  workspace,
  /const \[inspectorOpen,\s*setInspectorOpen\] = useState\(false\);/,
  "Agents mode should start with the inspector collapsed so the brain toggle is visible",
);
