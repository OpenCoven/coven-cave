// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Each surface defers destructive deletes through the shared useUndoDelete hook
// and surfaces an UndoToast — the same recoverable pattern as board/chat/library.
for (const rel of [
  "./vault-panel.tsx",
  "./automations-view.tsx",
  "./journal/journal-entries.tsx",
  "./familiar-studio-lifecycle-tab.tsx",
]) {
  const src = read(rel);
  assert.match(src, /import \{ useUndoDelete \} from "@\/lib\/use-undo-delete"/, `${rel} imports useUndoDelete`);
  assert.match(src, /import \{ UndoToast \} from "@\/components\/ui\/undo-toast"/, `${rel} imports UndoToast`);
  assert.match(src, /useUndoDelete</, `${rel} instantiates the undo hook`);
  assert.match(src, /scheduleDelete\(/, `${rel} schedules a deferred delete`);
  assert.match(src, /<UndoToast/, `${rel} renders the UndoToast`);
}

// Vault: the secret row hides during the undo window via a pending-key filter.
{
  const src = read("./vault-panel.tsx");
  assert.match(src, /deletePending\.item\.key/, "vault hides the pending secret row during the undo window");
}

// Automations: inbox rows + automations both hide by pending id; the inbox
// bulk delete routes through the deferred helper (no async confirm).
{
  const src = read("./automations-view.tsx");
  assert.match(src, /hiddenIds\.has\(it\.id\)/, "automations hides pending inbox rows");
  assert.match(src, /hiddenIds\.has\(a\.id\)/, "automations hides pending codex automations");
  assert.match(src, /const inboxBulkDelete = \(\) =>/, "bulk inbox delete is deferred (no async confirm)");
}

// Journal: a pending date makes the day read as empty without mutating `day`.
{
  const src = read("./journal/journal-entries.tsx");
  assert.match(src, /day\?\.date !== deletePending\?\.item/, "journal treats the pending day as empty during the undo window");
}

// Familiar lifecycle: a familiar pending removal hides from BOTH the active and
// archived lists during the undo window (the toast is its only handle).
{
  const src = read("./familiar-studio-lifecycle-tab.tsx");
  assert.match(src, /f\.id === pendingRemoveId/, "lifecycle tab hides the pending familiar row during the undo window");
}

console.log("delete-undo-surfaces.test.ts OK");
