// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Consolidated chat settings (the chat page's Settings tab) + auto-archive on
// thread reflections. Source-contract tests in the repo's house style: the tab
// must exist on the chat surface, the settings view must round-trip the
// `chatAutoArchive` policy through /api/config, and the reflect flows must
// refresh the session list when a reflection auto-archived the thread.

const settingsView = readFileSync(new URL("./chat-settings-view.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// --- chat-surface: Settings is a first-class chat scope tab -------------------

assert.match(
  surface,
  /type FamiliarsScope = "conversation" \| "projects" \| "coven" \| "familiar" \| "settings"/,
  "chat surface must know the settings scope",
);
assert.match(
  surface,
  /\{\s*id:\s*"settings",\s*label:\s*"Settings"\s*\}/,
  "chat exposes Settings as a dedicated tab beside Sessions/Projects",
);
assert.match(
  surface,
  /scope === "settings" \? \([\s\S]*?<ChatSettingsView \/>/,
  "the settings scope renders the consolidated ChatSettingsView",
);
assert.match(
  surface,
  /import \{ ChatSettingsView \} from "@\/components\/chat-settings-view"/,
  "chat-surface imports ChatSettingsView",
);

// --- chat-settings-view: reads and writes the policy through /api/config ------

assert.match(
  settingsView,
  /normalizeChatAutoArchivePolicy\(json\.config\?\.chatAutoArchive\)/,
  "settings view must normalize the stored policy (tolerates partial/corrupt config)",
);
assert.match(
  settingsView,
  /fetch\("\/api\/config", \{ cache: "no-store"/,
  "settings view loads the live config, never a cached copy",
);
assert.match(
  settingsView,
  /method: "PATCH",[\s\S]*?JSON\.stringify\(\{ chatAutoArchive: patch \}\)/,
  "settings view persists partial policies through the config PATCH merge",
);

// Every policy field is editable from the tab — master switch, the event
// triggers (task completion, thread reflection, PR merge), and the two
// idle windows.
for (const field of [
  "enabled",
  "archiveOnTaskCompletion",
  "archiveOnReflection",
  "archiveOnPrMerge",
  "externalAfterDays",
  "idleAfterDays",
]) {
  assert.match(
    settingsView,
    new RegExp(`update\\(\\{ ${field} \\}\\)`),
    `settings view edits ${field}`,
  );
}
assert.match(
  settingsView,
  /role="switch"[\s\S]*?aria-checked=\{checked\}/,
  "policy toggles are accessible switches, matching the settings shell idiom",
);
assert.match(
  settingsView,
  /After thread reflection/,
  "the reflection auto-archive toggle is labeled for what it does",
);
assert.match(
  settingsView,
  /After PR merge/,
  "the merged-PR auto-archive toggle is labeled for what it does",
);

// A failed save must not lie about state: revert the optimistic change.
assert.match(
  settingsView,
  /\.catch\(\(\) => \{\s*setPolicy\(previous\);/,
  "failed PATCHes revert the optimistic policy update",
);

// --- chat-view: reflect flows react to a reflection-triggered archive ---------

assert.match(
  chatView,
  /report: ThreadSelfReport; archivedAt\?: string/,
  "reflect responses carry the optional archive timestamp",
);
const refreshOnArchive = chatView.match(/if \(json\.archivedAt\) onSessionsChanged\?\.\(\);/g) ?? [];
assert.equal(
  refreshOnArchive.length,
  2,
  "both manual reflect and auto self-report refresh the session list when the thread archived",
);

console.log("chat-settings-view.test.ts ok");
