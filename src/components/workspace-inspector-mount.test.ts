// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /import \{ AgentsView \} from "@\/components\/agents-view";/,
  "Workspace should import AgentsView so agent sessions and the inspector are integrated",
);

assert.match(
  workspace,
  /<AgentsView[\s\S]*inboxItems=\{inboxItemsWithEphemeral\}[\s\S]*onOpenInbox=\{\(\) => setMode\("schedules"\)\}[\s\S]*onCreateReminder=\{openReminderForFamiliar\}[\s\S]*onOpenInboxItem=\{openInspectorInboxItem\}[\s\S]*onInboxItemChanged=\{refreshInbox\}/,
  "Agents mode should mount the integrated view with fully wired familiar Inbox controls",
);

assert.match(
  workspace,
  /const \[inspectorOpen,\s*setInspectorOpen\] = useState\(false\);/,
  "Agents mode should start with the inspector collapsed so the brain toggle is visible",
);
