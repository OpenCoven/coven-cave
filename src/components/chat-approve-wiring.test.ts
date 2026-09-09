import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const start = source.indexOf("async function sendApprovalAnswers(");
const end = source.indexOf("const transcriptHandlersRef =", start);
const submit = source.slice(start, end);

test("approval answers use the real send boundary with their own parent and no draft data", () => {
  assert.ok(start > 0 && end > start);
  assert.match(submit, /await sendRaw\(text, \[\], \[\], \{ parentTurnId: turnId \}/);
  assert.doesNotMatch(submit, /setInput|clearDraft|clearAttachments|draftInComposer|buildQuotedPrompt|intentFromSlash/);
  assert.match(submit, /onPersisted: \(\) => \{ persisted = true; \}/);
  assert.match(submit, /return persisted/);
});

test("memoized cards read the latest send callback and compare availability", () => {
  assert.match(source, /handlersRef\.current\.sendApprovalAnswers\(turn\.id, text\)/);
  assert.match(source, /prev\.approvalDisabledReason === next\.approvalDisabledReason/);
  assert.match(source, /currentSessionRef\.current === originSessionId/);
  assert.match(source, /!transcriptHandlersRef\.current\.approvalUnavailableReason\(turnId\)/);
});

test("card submission revalidates after the asynchronous runtime mutation boundary", () => {
  const sendRaw = source.slice(source.indexOf("const sendRaw = async ("), start);
  assert.ok(sendRaw.indexOf("await runtimeMutation") < sendRaw.indexOf("!submission.canSend()"));
  assert.ok(sendRaw.indexOf("!submission.canSend()") < sendRaw.indexOf('fetch("/api/chat/send"'));
  assert.match(sendRaw, /attentionSettlement\.markPersistenceConfirmed\(\);\s*submission\?\.onPersisted\(\)/);
});
