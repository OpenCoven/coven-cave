import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { pendingHistorySystemTurns, startChatTranscriptLoad } from "./chat-transcript-load.ts";

test("pending history may retain informational notices, but not replace sends, edits or resets", () => {
  const user = { role: "user", text: "Saved question" };
  const assistant = { role: "assistant", text: "Saved answer" };
  const help = { role: "system", text: "Local help" };
  const painted = [user, assistant];
  assert.deepEqual(pendingHistorySystemTurns(painted, painted), []);
  assert.deepEqual(pendingHistorySystemTurns(painted, [...painted, help]), [help]);
  assert.equal(pendingHistorySystemTurns(painted, [...painted, { role: "user", text: "New send" }]), null);
  assert.equal(pendingHistorySystemTurns(painted, [user, { ...assistant, text: "Edited answer" }]), null);
  assert.equal(pendingHistorySystemTurns(painted, []), null);
  assert.equal(pendingHistorySystemTurns([], []), null, "clear during an initially empty load remains a reset");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("network starts immediately alongside cache and never awaits slow decryption", async () => {
  const order: string[] = [];
  const cache = deferred<string | null>();
  const network = deferred<string | null>();
  const painted: string[] = [];
  const load = startChatTranscriptLoad({
    loadNetwork: () => { order.push("network"); return network.promise; },
    loadDurable: () => { order.push("cache"); return cache.promise; },
    onPendingDurable: (payload) => painted.push(payload),
  });
  assert.deepEqual(order, ["network", "cache"]);
  network.resolve("fresh");
  assert.equal(await load.network, "fresh");
  cache.resolve("old");
  assert.equal(await load.durable, "old");
  assert.deepEqual(painted, [], "late offline data never overwrites network truth");
});

test("fast durable cache paints once while network is pending", async () => {
  const cache = deferred<string | null>();
  const network = deferred<string | null>();
  const painted: string[] = [];
  const load = startChatTranscriptLoad({
    loadNetwork: () => network.promise,
    loadDurable: () => cache.promise,
    onPendingDurable: (payload) => painted.push(payload),
  });
  cache.resolve("durable");
  await load.durable;
  assert.deepEqual(painted, ["durable"]);
  network.resolve("fresh");
  assert.equal(await load.network, "fresh");
});

test("network failure settles promptly and durable stays available for explicit fallback", async () => {
  const cache = deferred<string | null>();
  const network = deferred<string | null>();
  const painted: string[] = [];
  const load = startChatTranscriptLoad({
    loadNetwork: () => network.promise,
    loadDurable: () => cache.promise,
    onPendingDurable: (payload) => painted.push(payload),
  });
  const rejection = assert.rejects(load.network, /offline/);
  network.reject(new Error("offline"));
  await rejection;
  cache.resolve("saved");
  assert.equal(await load.durable, "saved");
  assert.deepEqual(painted, [], "failure also closes automatic cache painting");
});

test("cache failure cannot fail successful network history", async () => {
  const load = startChatTranscriptLoad({
    loadNetwork: async () => "fresh",
    loadDurable: async () => { throw new Error("decrypt"); },
    onPendingDurable: () => assert.fail("no valid cache"),
  });
  assert.equal(await load.network, "fresh");
  assert.equal(await load.durable, null);
});

test("caller ownership guards can refuse cache paint after a live generation or switch", async () => {
  for (const reason of ["live", "switched"]) {
    const cache = deferred<string | null>();
    const network = deferred<string | null>();
    let ownsHistory = true;
    const painted: string[] = [];
    const load = startChatTranscriptLoad({
      loadNetwork: () => network.promise,
      loadDurable: () => cache.promise,
      onPendingDurable: (payload) => { if (ownsHistory) painted.push(payload); },
    });
    ownsHistory = false;
    cache.resolve("stale");
    await load.durable;
    assert.deepEqual(painted, [], reason);
    network.resolve("fresh");
    await load.network;
  }
});

test("ChatView binds saved-history loading to current owner refs and keeps all reset surfaces fenced", () => {
  const source = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("chat-view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect: ts.Block | undefined;
  let resets = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect") {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body) && callback.body.statements.some(statement =>
        ts.isReturnStatement(statement) && statement.expression && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(parsed) === "startChatHistoryLoad"
      )) effect = callback.body;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && node.left.getText(parsed) === "transcriptResetRevisionRef.current") resets += 1;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(effect, "the admitted history effect delegates to the coordinator");
  assert.equal(resets, 3, "each of the three explicit clear surfaces fences pending history");
  const start = effect.statements.findIndex(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === "endThreadSpan"));
  assert.ok(start >= 0, "the owning view starts the existing thread-open span");
  const body = ts.transpile(effect.statements.slice(start).map(statement => statement.getText(parsed)).join("\n"), { target: ts.ScriptTarget.ESNext });
  const turnsRef = { current: [{ id: "saved" }] };
  const resetRef = { current: 7 };
  const sources = {};
  let captured: Record<string, unknown> | undefined;
  const cleanup = () => {};
  const spanCalls: string[] = [];
  let settled = 0;
  let active = false;
  const setters = Array.from({ length: 5 }, () => () => {});
  const keepLiveSession = () => true;
  const run = new Function("startChatHistoryLoad", "sessionId", "isThreadSwitch", "flowBackedSession", "chatHistorySources", "turnsRef", "transcriptResetRevisionRef", "readLiveChatGeneration", "isLiveSnapshotActive", "keepLiveSession", "setTurns", "setActiveLeafId", "setHistoryState", "setLinkedContext", "setFlowTranscriptFallback", "startSpan", "THREAD_OPEN_SPAN", "markStartupSettled", body);
  const returned = run((options: Record<string, unknown>) => { captured = options; return cleanup; }, "chat", true, false, sources, turnsRef, resetRef,
    (id: string) => { assert.equal(id, "chat"); return active ? {} : null; }, () => active, keepLiveSession, ...setters,
    (name: string) => { spanCalls.push(name); return () => { spanCalls.push("painted"); }; }, "chat:thread-open", () => { settled += 1; });
  assert.equal(returned, cleanup, "React cleanup fences the delegated loader");
  assert.equal(captured?.sessionId, "chat");
  assert.equal(captured?.isThreadSwitch, true);
  assert.equal(captured?.flowBackedSession, false);
  assert.equal(captured?.sources, sources);
  const view = captured?.view as import("./chat/history-load.ts").ChatHistoryView;
  assert.equal(view.readTurns(), turnsRef.current);
  const next = [{ id: "new", role: "user" as const, text: "New", createdAt: "2026-10-05T00:00:00.000Z" }];
  view.syncTurns(next);
  assert.equal(turnsRef.current, next);
  resetRef.current += 1;
  assert.equal(view.readResetRevision(), 8, "reads live reset ownership rather than a snapshot");
  assert.equal(view.hasLiveGeneration(), false);
  active = true;
  assert.equal(view.hasLiveGeneration(), true);
  assert.equal(view.keepLiveSession, keepLiveSession);
  assert.deepEqual([view.setTurns, view.setActiveLeafId, view.setState, view.setContext, view.setFallback], setters);
  view.onPaint();
  assert.deepEqual(spanCalls, ["chat:thread-open", "painted"]);
  assert.equal(settled, 1);
});
