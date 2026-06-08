// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const inspectorPane = await readFile(new URL("./inspector-pane.tsx", import.meta.url), "utf8");
const agentsView = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  inspectorPane,
  /import \{ SnoozeMenu \} from "@\/components\/snooze-menu";/,
  "Inspector Inbox should use the shared snooze menu instead of a fixed 10-minute-only action",
);

assert.match(
  inspectorPane,
  /onCreateReminder\?: \(familiarId: string\) => void;/,
  "InspectorPane should expose a familiar-scoped reminder creation callback",
);

assert.match(
  inspectorPane,
  /onOpenInboxItem\?: \(item: InboxItem\) => void;/,
  "InspectorPane should expose item routing for session-backed Inbox items",
);

assert.match(
  inspectorPane,
  /onInboxItemChanged\?: \(\) => void \| Promise<void>;/,
  "Inspector Inbox actions should be able to refresh parent Inbox state after writes",
);

assert.match(
  inspectorPane,
  /onCreateReminder\(familiar\.id\)/,
  "Inspector Inbox should create reminders already scoped to the selected familiar",
);

assert.match(
  inspectorPane,
  /<SnoozeMenu[\s\S]*size="xs"[\s\S]*onSnooze=\{\(untilIso\) => runItemAction\(it, "snooze",/,
  "Inspector Inbox should expose the same snooze presets as the toast/full Inbox surfaces",
);

assert.match(
  inspectorPane,
  /onOpenInboxItem\?\.\(it\)/,
  "Inspector Inbox rows should route through the parent instead of dead-ending in the side pane",
);

assert.match(
  inspectorPane,
  /await onInboxItemChanged\?\.\(\);/,
  "Inspector Inbox write actions should refresh the parent after the API call resolves",
);

assert.match(
  inspectorPane,
  /fetch\(`\/api\/inbox\/\$\{encodeURIComponent\(item\.id\)\}\/\$\{action\}`/,
  "Inspector Inbox should URL-encode item ids before calling per-item action routes",
);

assert.match(
  agentsView,
  /onCreateReminder=\{onCreateReminder\}[\s\S]*onOpenInboxItem=\{onOpenInboxItem\}[\s\S]*onInboxItemChanged=\{onInboxItemChanged\}/,
  "ChatSurface should thread Inspector Inbox callbacks into the right panel",
);

assert.match(
  workspace,
  /const openReminderForFamiliar = useCallback\(\(familiarId: string\) => \{[\s\S]*setActiveId\(familiarId\);[\s\S]*openReminderModal\(\);/,
  "Workspace should open the reminder modal with the Inspector familiar selected",
);

assert.match(
  workspace,
  /const openInspectorInboxItem = useCallback\(\(item: InboxItem\) => \{[\s\S]*openAgentSession\(sessionId, item\.familiarId\)[\s\S]*setMode\("inbox"\)/,
  "Workspace should route Inspector Inbox items to chat sessions when possible and Inbox otherwise",
);
