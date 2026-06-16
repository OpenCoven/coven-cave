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
  /import \{ emitArchiveNudge \} from "@\/lib\/task-archive-nudge-emit"/,
  "card lifecycle route imports the archive nudge emitter",
);
assert.match(
  lifecycleRoute,
  /if \(card\.lifecycle === "completed"\) \{[\s\S]*?await emitArchiveNudge\(card\);[\s\S]*?\}/,
  "card lifecycle route emits a nudge after a card reaches completed",
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

console.log("task-archive-nudge-wiring.test.ts ok");
