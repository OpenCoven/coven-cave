import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatViewSource = ts.createSourceFile(
  "chat-view.tsx",
  chatView,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const historyNoticeDeclaration = chatViewSource.statements.find(
  (statement) =>
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === "ChatHistoryNotice",
);
const historyNotice = historyNoticeDeclaration
  ? chatView.slice(
      historyNoticeDeclaration.getStart(chatViewSource),
      historyNoticeDeclaration.getEnd(),
    )
  : "";
assert.ok(historyNotice, "ChatHistoryNotice source block is extractable");

test("chat history empty and failure states use semantic UI primitives", () => {
  assert.match(
    chatView,
    /import \{ EmptyState \} from "@\/components\/ui\/empty-state"/,
    "missing history uses the shared EmptyState",
  );
  assert.match(
    chatView,
    /import \{ ErrorState \} from "@\/components\/ui\/error-state"/,
    "history request failure uses the shared ErrorState",
  );
  assert.match(
    chatView,
    /variant === "error" \? \([\s\S]*?<ErrorState[\s\S]*?className="mx-auto w-full max-w-sm"[\s\S]*?headline=\{title\}[\s\S]*?subtitle=\{body\}[\s\S]*?actions=\{actions\}/,
    "the failure path keeps alert semantics through ErrorState",
  );
  assert.match(
    chatView,
    /<EmptyState[\s\S]*?className="mx-auto w-full max-w-sm"[\s\S]*?icon="ph:chats"[\s\S]*?headline=\{title\}[\s\S]*?subtitle=\{body\}[\s\S]*?actions=\{actions\}/,
    "the unavailable-history path keeps status semantics through EmptyState",
  );
});

test("chat history recovery uses direct verbs and shared buttons", () => {
  assert.match(
    chatView,
    /import \{ Button \} from "@\/components\/ui\/button"/,
    "history actions use the shared Button primitive",
  );
  assert.match(chatView, />\s*Back to chats\s*<\/Button>/, "back action names the user-facing destination");
  assert.match(chatView, />\s*Retry\s*<\/Button>/, "retry action keeps the recovery verb");
  assert.match(chatView, /title="Couldn't load chat history"/, "failure copy follows the state grammar");
  assert.match(
    chatView,
    /This chat exists, but Coven Cave couldn't find a saved transcript yet\./,
    "missing history uses the canonical brand and chat-first vocabulary",
  );
  assert.match(
    chatView,
    /You can still continue this chat\./,
    "failure recovery keeps the user-facing chat noun",
  );
  assert.doesNotMatch(
    historyNotice,
    /cave-btn/,
    "history states no longer carry a parallel button vocabulary",
  );
});
