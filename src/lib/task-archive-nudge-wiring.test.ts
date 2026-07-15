// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lifecycleRoute = readFileSync(
  new URL("../app/api/board/[id]/lifecycle/route.ts", import.meta.url),
  "utf8",
);
const sessionRoute = readFileSync(
  new URL("../app/api/sessions/[id]/route.ts", import.meta.url),
  "utf8",
);
const emitModule = readFileSync(new URL("./task-archive-nudge-emit.ts", import.meta.url), "utf8");

assert.match(
  lifecycleRoute,
  /import \{ handleTaskCompletion \} from "@\/lib\/task-archive-nudge-emit"/,
  "card lifecycle route imports the task-completion handler",
);
assert.match(
  lifecycleRoute,
  /if \(card\.lifecycle === "completed"\) \{[\s\S]*?await handleTaskCompletion\(card\);[\s\S]*?\}/,
  "card lifecycle route hands completed cards to the archive/nudge handler",
);

assert.match(
  sessionRoute,
  /import \{ resolveArchiveNudges \} from "@\/lib\/task-archive-nudge-emit"/,
  "session route imports the archive nudge resolver",
);
assert.match(
  sessionRoute,
  /result\.archivedAt = await archiveSessionLocal\(id\);[\s\S]*?await resolveArchiveNudges\(id\);/,
  "session archive resolves any active archive nudges for that session",
);

assert.match(emitModule, /try \{[\s\S]*?createItem\(input\)[\s\S]*?broadcastCreated\(item\)[\s\S]*?\} catch \{[\s\S]*?return null;/);
assert.match(emitModule, /try \{[\s\S]*?markDone\(nudge\.id\)[\s\S]*?broadcastUpdated\(updated\)[\s\S]*?\} catch \{[\s\S]*?return 0;/);

// handleTaskCompletion: policy-gated auto-archive with the nudge as fallback.
assert.match(
  emitModule,
  /shouldAutoArchiveOnTaskCompletion\(sessionId, policy, \{[\s\S]*?\}\)[\s\S]*?await archiveSessionLocal\(sessionId as string\);[\s\S]*?await resolveArchiveNudges\(sessionId as string\);[\s\S]*?return \{ action: "archived" \};/,
  "completion handler archives the linked chat and resolves its nudges when the policy opts in",
);
assert.match(
  emitModule,
  /const item = await emitArchiveNudge\(card\);\s*return \{ action: item \? "nudged" : "none" \};/,
  "completion handler falls back to the archive nudge",
);

// The session list sweep is wired through the shared sweep module.
const sessionsListRoute = readFileSync(
  new URL("../app/api/sessions/list/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  sessionsListRoute,
  /import \{\s*sweepAutoArchive,\s*sweepMergedPrAutoArchive,?\s*\} from "@\/lib\/chat-auto-archive-sweep"/,
  "sessions list imports both sweeps from the shared sweep module",
);
assert.match(
  sessionsListRoute,
  /await sweepAutoArchive\(sessions, state\)/,
  "sessions list sweeps the merged rows",
);

const sweepModule = readFileSync(
  new URL("./chat-auto-archive-sweep.ts", import.meta.url),
  "utf8",
);
assert.match(
  sweepModule,
  /try \{[\s\S]*?autoArchiveSessionsLocal\(decisions\.map[\s\S]*?resolveArchiveNudges\(sessionId\)[\s\S]*?\} catch \{[\s\S]*?return new Map\(\);/,
  "sweep archives due sessions, resolves their nudges, and is best-effort",
);

console.log("task-archive-nudge-wiring.test.ts ok");
