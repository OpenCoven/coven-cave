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
  /<AgentsView[\s\S]*inboxItems=\{inboxItemsWithEphemeral\}[\s\S]*onOpenInbox=\{\(\) => setMode\("inbox"\)\}/,
  "Agents mode should mount the integrated view with the inbox-backed inspector data",
);

assert.match(
  workspace,
  /const \[inspectorOpen,\s*setInspectorOpen\] = useState\(false\);/,
  "Agents mode should start with the inspector collapsed so the brain toggle is visible",
);
