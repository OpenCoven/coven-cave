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
    /import \{[^}]*\bparseHarnessFailure, parseHarnessAuthFailure, type HarnessAuthFailure \} from "@\/lib\/harness-failure"/,
    "chat-view should parse harness failures (and auth failures, cave-f6ol) from the shared lib",
  );
  assert.match(
    source,
    /parseHarnessFailure\(recoveryText\)/,
    "ChatErrorStrip should parse raw in-memory recovery context without exposing it in copied diagnostics",
  );
  assert.match(
    source,
    /parseHarnessAuthFailure\([\s\S]{0,300}\brecoveryText,\s+harnessId,?\s*\)/,
    "ChatErrorStrip should detect runtime sign-in failures with the failing send's runtime (cave-f6ol)",
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
    /handleUseHarnessFix[\s\S]{0,600}method: "PATCH"[\s\S]{0,300}familiars: \{[\s\S]*?\[familiar\.id\]: \{[\s\S]*?harness: runtime,[\s\S]*?model: nextModel/,
    "the fix handler should rebind the familiar via /api/config PATCH",
  );
  assert.match(
    source,
    /async function handleUseHarnessFix\(runtime: string\) \{[\s\S]*?if \(sessionId\) \{[\s\S]*?conversation is pinned to its original runtime[\s\S]*?announce\(message, "assertive"\)[\s\S]*?return;/,
    "the fix handler must not claim to switch an existing conversation whose persisted harness pins the retry",
  );
  assert.match(
    source,
    /onUseHarness=\{lastFailedSend \? handleUseHarnessFix : undefined\}/,
    "the strip only offers a switch when there is a failed send to retry",
  );
}

// ── Chat view: UsageLimitFixRow (#5938) ──────────────────────────────────────
// A spent plan allowance must not end at a Retry that re-sends the exhausted
// model. The strip swaps Retry for a one-turn model switch, and the row never
// renders the provider's notice (which can carry a tracking URL).
{
  const source = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
  assert.match(source, /const usageLimit = code === "harness_usage_limit";/, "the strip recognizes the usage-limit code");
  assert.match(source, /\{canRetry && !usageLimit \? \(/, "a quota failure hides the plain Retry");
  assert.match(
    source,
    /code !== "harness_auth_configuration_required" && !usageLimit \? \(/,
    "a quota failure hides the raw code badge",
  );
  assert.match(source, /\(\) => code === "harness_auth_required" \|\| usageLimit \? null : parseHarnessFailure\(recoveryText\)/, "the harness-switch row is skipped for a quota");
  assert.match(source, /\(\) => usageLimit \? null : parseHarnessAuthFailure\(/, "the sign-in row is skipped for a quota");
  assert.match(source, /\{usageLimit && onRetryWithModel \? \(\s*<UsageLimitFixRow/, "the strip renders the usage-limit row");
  assert.match(source, /modelOptions\.filter\(\(option\) => option\.id !== model\)/, "the exhausted model is left out of the switch menu");
  assert.match(source, /<ComposerModelPopover[\s\S]{0,400}modelOptions=\{otherModels\}/, "the switch reuses the composer's model menu");
  assert.match(source, /Use another model…/, "the primary action uses the single ellipsis character");
  assert.match(source, /Use runtime default/, "the secondary action falls back to the runtime default");
  assert.match(source, /harnessId === "claude" && onManageUsage \?/, "Manage usage is offered for Claude only");
  assert.match(source, /const CLAUDE_USAGE_SETTINGS_URL = "https:\/\/claude\.ai\/settings\/usage";/, "the usage page is a fixed URL, never one parsed from provider text");
  assert.match(source, /if \(onOpenUrl\) onOpenUrl\(CLAUDE_USAGE_SETTINGS_URL\);/, "Manage usage opens through the host's URL path");
  assert.match(
    source,
    /\(modelId\) => retryFailedSend\(\{ modelOverride: modelId, modelOverrideScope: "next-message" \}\)/,
    "a picked model retries the failed send for the next message only",
  );
  assert.match(source, /announce\(`Retrying with \$\{label\} for this message\.`\)/, "the switch is announced");
  assert.match(source, /You&apos;ve used up the quota for \{exhaustedModel\}\. Pick another model for this message, or try\s+again after the limit resets\./, "the row copy names the exhausted model and the next step");
  const row = source.slice(source.indexOf("function UsageLimitFixRow"), source.indexOf("function AuthFixRow"));
  assert.doesNotMatch(row, /\{message\}|recoveryText|detailText/, "the row renders no provider text");
  assert.match(source, /raiseDebugError\(\{ turnId: assistantId, code: ev\.code, harness: ev\.harness, model: ev\.model \}\)/, "the failed send's model reaches the strip");
}

// ── Group chat: error replies ────────────────────────────────────────────────
{
  // The coven redesign moved the failure CARD (and its harness recovery
  // buttons) into CovenAgentSection; group-chat-view still owns the handler
  // those buttons call, so the two halves are asserted against their files.
  const source = await readFile(new URL("./group-chat-view.tsx", import.meta.url), "utf8");
  const section = await readFile(new URL("./coven-agent-section.tsx", import.meta.url), "utf8");
  assert.match(
    section,
    /parseHarnessFailure\(reply\.error\)/,
    "group chat should parse each error reply's text",
  );
  assert.match(
    section,
    /<HarnessFixActions[\s\S]{0,160}onUseHarness=\{onUseHarness\}/,
    "the failure card should offer the harness recovery actions",
  );
  assert.match(
    source,
    /onUseHarness=\{\(runtime\) =>[\s\S]{0,120}applyHarnessToReply\(agent\.reply, runtime\)/,
    "group chat should wire each failure card to the per-reply harness-fix handler",
  );
  assert.match(
    source,
    /applyHarnessToReply/,
    "group chat should define a per-reply harness-fix handler",
  );
  assert.match(
    source,
    /familiars: \{[\s\S]*?\[reply\.familiarId\]: \{[\s\S]*?harness: runtime,[\s\S]*?model: modelForRuntimeSwitch\(runtime\)/,
    "the group-chat fix should rebind the failing reply's familiar",
  );
  assert.match(
    source,
    /await retryReply\(reply\)/,
    "after rebinding, the group-chat fix should re-run just that reply",
  );
  assert.match(
    source,
    /const applyHarnessToReply = useCallback\([\s\S]*?if \(reply\.sessionId \|\| activeGroupRef\.current\?\.sessions\[reply\.familiarId\]\) \{[\s\S]*?reply is pinned to its original runtime[\s\S]*?return;/,
    "group-chat recovery must not rebind a familiar when the failed reply already has a pinned session",
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
    /await openTaskWork\(id\)/,
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
