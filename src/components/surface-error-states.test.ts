// @ts-nocheck
// Cross-surface error-state consistency: load-failure banners carry an icon,
// a truncating message, and a retry affordance; transient action failures are
// dismissable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const board = read("./board-view.tsx");
assert.match(
  board,
  /\{error && \([\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?void load\(\{ force: true \}\)[\s\S]*?Retry/,
  "Board load-failure banner has icon + Retry wired to a forced reload",
);

const inbox = read("./automations-view.tsx");
assert.match(
  inbox,
  /\{error && \([\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?void load\(true\)[\s\S]*?Retry/,
  "Inbox/automations load-failure banner has icon + Retry wired to a forced reload",
);

const chatList = read("./chat-list.tsx");
assert.match(
  chatList,
  /\{error && \([\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?setError\(null\)/,
  "Chat list launch-failure banner has icon + dismiss",
);

const vault = read("./vault-panel.tsx");
assert.match(
  vault,
  /catch \(e\)[\s\S]*?setError\(/,
  "Vault panel surfaces fetch failures instead of swallowing them in an empty catch",
);
assert.match(
  vault,
  /<ErrorState[\s\S]*?void load\(\)[\s\S]*?Retry/,
  "Vault panel load failure uses the shared ErrorState with Retry wired to load()",
);
assert.match(
  vault,
  /<EmptyState[\s\S]*?No mappings yet[\s\S]*?Add mapping/,
  "Vault panel empty state has an Add mapping action, not bare text",
);

console.log("surface-error-states.test.ts: ok");
