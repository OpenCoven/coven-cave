import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");

test("preview navigation opens Browser as a right split without replacing Chat", () => {
  const callback = workspace.match(
    /const openPreviewBeside = useCallback\([\s\S]*?\n  }, \[addSplitTarget\]\);/,
  )?.[0] ?? "";
  assert.match(callback, /enqueueBrowserNavigation/);
  assert.match(callback, /activeChatSessionIdRef\.current/);
  assert.match(callback, /setPendingChatAction\(\{ kind: "open"/);
  assert.match(
    callback,
    /normalizeWorkspacePaneRequest\("chat-preview-browser", "browser"\)/,
  );
  assert.match(callback, /addSplitTarget\(target, "right"\)/);
  assert.doesNotMatch(callback, /setMode\(/);
  assert.match(workspace, /onOpenPreview=\{openPreviewBeside\}/);
});

test("settled assistant turns replace preview markers with cards", () => {
  assert.match(chatView, /slicePreviewBlocks\(segment\.text\)/);
  assert.match(chatView, /<ChatPreviewCard/);
  assert.match(chatView, /onOpenPreview=\{onOpenPreview\}/);
});

test("primary and split-pane chats share preview routing", () => {
  assert.equal(chatRouter.match(/onOpenPreview=\{onOpenPreview\}/g)?.length, 2);
});
