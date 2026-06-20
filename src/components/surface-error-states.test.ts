// @ts-nocheck
// Cross-surface error-state consistency: load-failure banners carry an icon,
// a truncating message, and a retry affordance; transient action failures are
// dismissable. One idiom across Board, Inbox, Chat list, and Library.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const board = read("./board-view.tsx");
assert.match(
  board,
  /\{error && \([\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?void load\(\)[\s\S]*?Retry/,
  "Board load-failure banner has icon + Retry wired to load()",
);

const inbox = read("./automations-view.tsx");
assert.match(
  inbox,
  /\{error && \([\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?void load\(\)[\s\S]*?Retry/,
  "Inbox/automations load-failure banner has icon + Retry wired to load()",
);

const chatList = read("./chat-list.tsx");
assert.match(
  chatList,
  /\{error && \([\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?setError\(null\)/,
  "Chat list launch-failure banner has icon + dismiss",
);

const docList = read("./library-doc-list.tsx");
assert.match(
  docList,
  /ph:warning-circle[\s\S]*?Couldn&rsquo;t load documents/,
  "Library doc-list error headline carries the warning icon",
);
assert.doesNotMatch(
  docList,
  /text-\[var\(--color-warning\)\]">Couldn&rsquo;t load documents/,
  "Library doc-list load failure uses danger (not warning) like other load failures",
);
assert.match(
  docList,
  /No documents yet\.[\s\S]*?Documents your familiars collect/,
  "Library doc-list empty state has title + hint instead of bare text",
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

const retro = read("./retro-runs-view.tsx");
assert.match(
  retro,
  /\{error \?[\s\S]*?role="alert"[\s\S]*?ph:warning-circle[\s\S]*?void load\(\)[\s\S]*?Retry/,
  "Retro runs error banner is role=alert with a Retry wired to load()",
);
assert.match(
  retro,
  /<EmptyState[\s\S]*?No matching retro runs\./,
  "Retro runs empty state uses the shared EmptyState",
);

console.log("surface-error-states.test.ts: ok");
