// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /import \{ ChatSurface(?:, [^}]+)? \} from "@\/components\/chat-surface";/,
  "Workspace should import ChatSurface so agent sessions and the inspector are integrated",
);

assert.match(
  workspace,
  /<ChatSurface[\s\S]*inboxItems=\{inboxItemsWithEphemeral\}[\s\S]*onOpenInbox=\{\(\) => setMode\("inbox"\)\}[\s\S]*onCreateReminder=\{openReminderForFamiliar\}[\s\S]*onOpenInboxItem=\{openInspectorInboxItem\}[\s\S]*onInboxItemChanged=\{refreshInbox\}/,
  "Chat mode should mount ChatSurface with fully wired familiar Inbox controls",
);

// cave-liut: the chat right panel starts closed and rightPanel is its single
// owner — the legacy inspectorOpen boolean channel is retired.
assert.match(
  workspace,
  /const \[rightPanel,\s*setRightPanel\] = useState<RightPanelKind \| null>\(null\);/,
  "Chat mode should start with the right panel collapsed, owned by rightPanel alone",
);

assert.doesNotMatch(
  workspace,
  /inspectorOpen|setInspectorOpen/,
  "Workspace must not keep the retired inspectorOpen boolean beside rightPanel",
);
