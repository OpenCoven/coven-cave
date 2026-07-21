import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");

assert.match(source, /resolveTaskWorkTarget\([\s\S]{0,120}card\.sessionId[\s\S]{0,160}fallbackSession/);
assert.match(source, /<ChatView[\s\S]*sessionId=\{target\.session\.id\}/);
assert.match(source, /onBack=\{onClose\}/);
assert.match(source, /Preparing work session/);
assert.match(source, /Work session unavailable/);
assert.match(source, /onSessionsDeleted=\{\(sessionIds\) =>/);
assert.match(source, /includeArchived: "1"/);
assert.match(source, /Unlink missing session/);
assert.match(source, /onUnlinkSession/);
assert.match(source, /tabIndex=\{-1\}/);
assert.match(source, /focus-ring/);
assert.match(source, /useWorkspaceRailController/);
assert.match(source, /<WorkspaceRail/);
assert.match(source, /<WorkspaceRailSheet/);
assert.doesNotMatch(source, /ChatRouter|ChatList/);
