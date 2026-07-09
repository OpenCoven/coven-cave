// @ts-nocheck
//
// Guard: harness/runtime failures render inline fix actions (cave-noox)
// everywhere the daemon's error prose can otherwise dead-end the user:
//   - chat view's ChatErrorStrip
//   - group chat error replies (next to Retry)
//   - board task-chat errors (top banner + inspector empty-chat card)
//
// The shared component (harness-fix-actions.tsx) offers "Use <Adapter>"
// switch buttons and "Copy fix command" for quoted `coven adapter …` lines;
// the parse logic itself is unit-tested in src/lib/harness-failure.test.ts.
// Source-string assertions keep this guard light (home-composer.test.ts style).
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ── The shared component ─────────────────────────────────────────────────────
{
  const source = await readFile(
    new URL("./harness-fix-actions.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /harnessSwitchTargets/,
    "HarnessFixActions should derive switch buttons from harnessSwitchTargets",
  );
  assert.match(
    source,
    /harnessFixCommand/,
    "HarnessFixActions should surface the quoted fix command via harnessFixCommand",
  );
  assert.match(
    source,
    /copyText/,
    "HarnessFixActions should copy via the shared clipboard helper (execCommand fallback)",
  );
  assert.match(
    source,
    /Use \{target\.label\}/,
    "switch buttons read 'Use <Adapter>'",
  );
}

// ── Chat view: ChatErrorStrip ────────────────────────────────────────────────
{
  const source = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ parseHarnessFailure \} from "@\/lib\/harness-failure"/,
    "chat-view should parse harness failures from the shared lib",
  );
  assert.match(
    source,
    /parseHarnessFailure\(detailText\)/,
    "ChatErrorStrip should parse the full detail text (message + code + tool/step output)",
  );
  assert.match(
    source,
    /<HarnessFixActions[\s\S]{0,200}onUseHarness=\{onUseHarness\}/,
    "ChatErrorStrip should render HarnessFixActions wired to onUseHarness",
  );
  assert.match(
    source,
    /async function handleUseHarnessFix\(runtime: string\)/,
    "chat-view should define the harness-fix recovery handler",
  );
  assert.match(
    source,
    /handleUseHarnessFix[\s\S]{0,600}method: "PATCH"[\s\S]{0,300}familiars: \{ \[familiar\.id\]: \{ harness: runtime/,
    "the fix handler should rebind the familiar via /api/config PATCH",
  );
  assert.match(
    source,
    /onUseHarness=\{lastFailedSend \? handleUseHarnessFix : undefined\}/,
    "the strip only offers a switch when there is a failed send to retry",
  );
}

// ── Group chat: error replies ────────────────────────────────────────────────
{
  const source = await readFile(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /parseHarnessFailure\(r\.error\)/,
    "group chat should parse each error reply's text",
  );
  assert.match(
    source,
    /useHarnessForReply/,
    "group chat should define a per-reply harness-fix handler",
  );
  assert.match(
    source,
    /familiars: \{ \[reply\.familiarId\]: \{ harness: runtime/,
    "the group-chat fix should rebind the failing reply's familiar",
  );
  assert.match(
    source,
    /await retryReply\(reply\)/,
    "after rebinding, the group-chat fix should re-run just that reply",
  );
}

// ── Board: chat-link error banner + inspector card ───────────────────────────
{
  const source = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /chatLinkErrorCardId/,
    "board should track which card's chat start failed",
  );
  assert.match(
    source,
    /useHarnessForTaskChat/,
    "board should define the task-chat harness-fix handler",
  );
  assert.match(
    source,
    /await onOpenTaskChat\(id\)/,
    "after rebinding, the board fix should re-run the task-chat start",
  );
  assert.match(
    source,
    /chatLinkFailure && chatLinkErrorCardId \?[\s\S]{0,200}<HarnessFixActions/,
    "the top banner should render fix actions for parsed harness failures",
  );
  assert.match(
    source,
    /onUseHarnessFix=\{[\s\S]{0,120}useHarnessForTaskChat/,
    "the inspector should receive the fix handler for the failing card",
  );
}
{
  const source = await readFile(new URL("./board-inspector.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /chatLinkError && onUseHarnessFix \? parseHarnessFailure\(chatLinkError\) : null/,
    "the inspector's empty-chat card should parse the chat-link error",
  );
  assert.match(
    source,
    /<HarnessFixActions[\s\S]{0,200}onUseHarness=\{onUseHarnessFix\}/,
    "the inspector's empty-chat card should render fix actions",
  );
}

console.log("harness-fix-actions.test.ts: ok");
