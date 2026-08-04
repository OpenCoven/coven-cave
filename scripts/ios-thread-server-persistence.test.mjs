// cave-ioswipe.6 (iOS half): thread archive/pin/delete must reach the server,
// not just the local thread store, or they die with the install and never
// reach another client.
//
// iOS Swift is NOT compiled by CI, so this source-text contract is the only
// gate. Each assertion is checked to FAIL against its regression, not merely
// to pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");

/** Extract a brace-balanced block starting at `marker` (which ends at its `{`). */
function blockAfter(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// -- Client ---------------------------------------------------------------
// The route updates a flag only when its key is present in the body, so an
// unset field must be ABSENT — not null, and emphatically not false. Encoding
// `false` for an untouched flag would unarchive a chat you only meant to pin.
const patch = blockAfter(client, "struct SessionFlagsPatch: Encodable {");
assert.ok(patch, "SessionFlagsPatch must exist");
assert.match(
  patch,
  /if let archived \{ try c\.encode\(archived, forKey: \.archived\) \}/,
  "archived must be encoded only when set",
);
assert.match(
  patch,
  /if let pinned \{ try c\.encode\(pinned, forKey: \.pinned\) \}/,
  "pinned must be encoded only when set",
);
assert.match(
  client,
  /func setSessionFlags\(sessionId: String, archived: Bool\? = nil, pinned: Bool\? = nil\) async throws/,
  "both flags must be independently optional",
);
assert.match(
  client,
  /func deleteSession\(sessionId: String\) async throws \{[\s\S]*?method: "DELETE"/,
  "deleteSession must issue a DELETE",
);

// -- Archive / pin fan-out ------------------------------------------------
for (const [fn, verbs, field] of [
  ["setThreadArchived", ["archive", "unarchive"], "archived"],
  ["setThreadPinned", ["pin", "unpin"], "pinned"],
]) {
  const body = blockAfter(model, `func ${fn}(_ thread: ChatThread, _ ${field}: Bool) {`);
  assert.ok(body, `${fn} must exist`);
  assert.match(
    body,
    new RegExp(`fanOutThreadFlag\\(target, verb: ${field} \\? "${verbs[0]}" : "${verbs[1]}"\\)`),
    `${fn} must push the change to the server, not only persistThreads()`,
  );
  assert.match(
    body,
    new RegExp(`client\\.setSessionFlags\\(sessionId: sessionId, ${field}: ${field}\\)`),
    `${fn} must send only its own flag, leaving the other absent`,
  );
  assert.match(
    body,
    new RegExp(`rollback: \\{ \\$0\\.${field} = !${field} \\}`),
    `${fn} must roll the flag back when the server rejects it`,
  );
}

// -- The fan-out helper itself -------------------------------------------
const helper = blockAfter(model, "private func fanOutThreadFlag(");
assert.ok(helper, "fanOutThreadFlag must exist");
assert.match(
  helper,
  /guard !ids\.isEmpty else \{ return \}/,
  "a thread that owns no session (never sent) must not attempt a server call",
);
assert.match(
  helper,
  /threadFlagWrites\[threadId\]\?\.cancel\(\)/,
  "a newer flag write must cancel the one it supersedes",
);
assert.match(
  helper,
  /guard let self, !Task\.isCancelled else \{ return \}/,
  "a superseded write must not roll back state the newer write already set",
);
assert.match(
  helper,
  /if failed > 0 \{[\s\S]*?rollback\(thread\)[\s\S]*?reportPartial\(failed, of: ids\.count, verb: verb\)/,
  "failure must roll back AND tell the user",
);

// Only sessions the thread actually owns are touched.
const owned = blockAfter(model, "private func serverSessionIds(_ thread: ChatThread) -> [String] {");
assert.ok(owned, "serverSessionIds must exist");
assert.match(
  owned,
  /thread\.sessionIds\.values\.filter \{ !\$0\.isEmpty \}/,
  "empty session ids must be filtered out, or the client PATCHes a bogus path",
);

// -- Delete fan-out -------------------------------------------------------
const del = blockAfter(model, "private func fanOutThreadDelete(");
assert.ok(del, "fanOutThreadDelete must exist");
assert.match(
  del,
  /let suppressedSessions = Self\.suppressServerSessions\([\s\S]*?self\.serverSessions = suppressedSessions\.remaining[\s\S]*?Task \{/,
  "server sessions owned by deleted threads must be suppressed synchronously before the async fan-out can expose them as server-only",
);
assert.match(
  del,
  /client\.deleteSession\(sessionId: sessionId\)/,
  "delete must reach the server",
);
assert.match(
  del,
  /Self\.restoringDeletedThreads\([\s\S]*?removed: removed[\s\S]*?restoring: restoreIDs/,
  "partial rollback must rebuild failed chats relative to successful deletions",
);
assert.match(
  del,
  /self\.serverSessions\.removeAll \{ successfulSessionIDs\.contains\(\$0\.id\) \}/,
  "successful deletes must be pruned again in case a concurrent refresh reintroduced them",
);
assert.match(
  del,
  /suppressedSessions\.suppressed\.filter\(\{ failedSessionIDs\.contains\(\$0\.id\) \}\)/,
  "failed deletes must restore their cached server rows without restoring successful siblings",
);
assert.match(
  del,
  /reportDeletePartial\(\s*restoredThreads: restoreIDs\.count,\s*failedSessions: failedSessions,\s*totalSessions: totalSessions\s*\)/,
  "partial-delete toast must distinguish restored chats from failed session operations",
);

// Both delete entry points must capture position BEFORE removing.
const one = blockAfter(model, "func deleteThread(_ thread: ChatThread) {");
assert.ok(one, "deleteThread must exist");
assert.match(
  one,
  /guard let index = threads\.firstIndex\(where: \{ \$0\.id == thread\.id \}\) else \{ return \}/,
  "deleteThread must capture the index before removing",
);
assert.match(one, /fanOutThreadDelete\(\[\(index, removed\)\]\)/, "deleteThread must fan out");

const many = blockAfter(model, "func deleteThreads(_ ids: Set<String>) {");
assert.ok(many, "deleteThreads must exist");
assert.match(
  many,
  /threads\.enumerated\(\)\s*\n\s*\.filter \{ ids\.contains\(\$0\.element\.id\) \}\s*\n\s*\.map \{ \(\$0\.offset, \$0\.element\) \}/,
  "deleteThreads must capture every position before removing",
);
assert.match(
  many,
  /guard !removed\.isEmpty else \{ return \}[\s\S]*?let n = removed\.count/,
  "deleteThreads must report only chats actually removed and no-op for stale-only selections",
);
assert.match(many, /fanOutThreadDelete\(removed\)/, "deleteThreads must fan out");

// -- No thread mutation may go back to being local-only -------------------
for (const fn of ["setThreadArchived", "setThreadPinned"]) {
  const body = blockAfter(model, `func ${fn}(_ thread: ChatThread, _ `);
  assert.ok(body, `${fn} must exist`);
  assert.ok(
    /fanOutThreadFlag\(/.test(body),
    `${fn} must not regress to persistThreads() alone — that is the bug this fixes`,
  );
}

console.log("ios-thread-server-persistence: ok");
