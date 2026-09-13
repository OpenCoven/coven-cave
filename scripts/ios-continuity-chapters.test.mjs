import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../apps/ios/CovenCave/${path}`, import.meta.url), "utf8");
const [chapters, thread, view, sheet, model, models, tests] = await Promise.all([
  read("CovenCave/State/ConversationChapters.swift"),
  read("CovenCave/State/ChatThread.swift"),
  read("CovenCave/Views/ChatView.swift"),
  read("CovenCave/Views/ConversationChaptersSheet.swift"),
  read("CovenCave/State/AppModel.swift"),
  read("CovenCave/Models/Models.swift"),
  read("CovenCaveTests/ConversationChaptersTests.swift"),
]);

assert.match(models, /var activeLeafId: String\?/);
assert.match(chapters, /static let algorithm = "utc-day-v1"/);
assert.match(chapters, /withJSONObject: \[algorithm, conversationId, turn\.id\]/);
assert.match(chapters, /guard !partial else \{ return \.init\(status: \.partial\) \}/);
assert.match(chapters, /seen\.insert\(turn\.id\)\.inserted/);
assert.match(chapters, /chapters\.last\?\.day == day/);
assert.doesNotMatch(chapters, /Date\(\)|Calendar\.current|displayName|familiarId|text:/);
assert.match(thread, /ConversationChapters\.activeBranch\(source, activeLeafId: conversation\.activeLeafId\)/);
assert.match(model, /try thread\.restoreConversation\(convo, familiarId: assignee\)/);
assert.doesNotMatch(thread + model, /restoredTranscript\(from: convo\.turns/);
assert.match(thread, /restored\[index\]\.id = displayId/);
assert.match(thread, /chapterIndex\.status == \.complete/);
assert.match(thread, /return displayIdBySourceId\[chapter\.firstTurnId\]/);
assert.match(thread, /guard !isStreaming, !messages\.contains\(where: \\.isQueued\)/);
assert.match(thread, /let read = beginConversationRead\(\)[\s\S]*?let conversation = try await client\.conversation\(sessionId: sessionId\)\s+guard canApplyConversationRead\(read\) else \{ return \}/);
assert.match(thread, /didSet \{\s+conversationMutationGeneration &\+= 1\s+guard !inPlaceMutation/);
assert.match(thread, /read\.requestGeneration == conversationReadGeneration/);
assert.match(thread, /read\.mutationGeneration == conversationMutationGeneration/);
assert.match(thread, /read\.sessionIds == sessionIds/);
const hydrationStart = model.indexOf("private func loadHistory(");
assert.ok(hydrationStart >= 0);
const hydration = model.slice(hydrationStart, model.indexOf("// MARK: - Threads", hydrationStart));
assert.match(hydration, /let read = thread\.beginConversationRead\(\)[\s\S]*?await client\.conversation\(sessionId: sessionId\)[\s\S]*?guard thread\.messages\.isEmpty, thread\.canApplyConversationRead\(read\) else \{ return \}/);
assert.match(view, /@AppStorage\(ConversationChapters\.preferenceKey\) private var chaptersEnabled = false/);
assert.match(view, /if chaptersEnabled \{/);
assert.match(view, /guard chaptersEnabled, let displayId = thread\.displayId\(for: chapter\)/);
assert.match(view, /streamScroll\.cancel\(\)\s+atBottom = false/);
assert.match(view, /proxy\.scrollTo\(displayId, anchor: \.top\)/);
assert.match(view, /\.id\(message\.id\)/);
assert.match(view, /streamScroll\.request \{\s+guard atBottom else \{ return \}/);
assert.match(sheet, /Your draft and reply target stay in this chat/);
assert.match(sheet, /Stable chapter anchors are unavailable/);
assert.match(tests, /testProductionRestoreAndNavigationPreserveDisplayIdentityAndExactTarget/);
assert.match(tests, /no chapter work on streamed text/);
assert.match(tests, /testLateReloadCannotOverwriteQueuedSendThatSettledDuringGET/);
assert.match(tests, /testSupersededReloadCannotApplyEvenBeforeNewerReadCompletes/);

const mutationStart = thread.indexOf("private func mutate(");
assert.ok(mutationStart >= 0, "the streaming mutation seam must still exist");
const mutation = thread.slice(mutationStart);
assert.doesNotMatch(mutation, /ConversationChapters\.build|rebuildTranscript\(\)/,
  "canonical chapter derivation must not enter the streaming hot path");
console.log("ios-continuity-chapters: OK");
