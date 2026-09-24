// Interface copy that the #5527 review found breaking the design language's
// §10 contract (vocabulary, placeholder grammar, failed-vs-empty states).
// Source-text pins: these strings are the contract, not an implementation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const kanban = read("./board-kanban.tsx");
assert.match(kanban, />\s*Add task\s*</, "kanban quick-add says task, not card");
assert.doesNotMatch(kanban, /Add a card/, "no visible 'card' for a task");

const boardView = read("./board-view.tsx");
assert.doesNotMatch(boardView, /The board collects/, "bare 'board' is not a destination name");

const automations = read("./automations-view.tsx");
assert.match(automations, /\{ id: "crons", label: "Scheduled jobs" \}/, "ordinary copy says scheduled job, not cron");

const canvas = read("./chat-canvas-view.tsx");
assert.doesNotMatch(canvas, /"Save to Canvas"\./, "quoted UI labels use curly quotes");

const boardSearch = read("./board-token-search.tsx");
assert.match(boardSearch, /"Search tasks…"/, "search placeholder follows 'Search <items>…'");
assert.doesNotMatch(boardSearch, /placeholder=\{[^}]*is:open/, "filter syntax is taught by suggestions, not the placeholder");

const topBar = read("./top-bar.tsx");
assert.match(topBar, /placeholder="Search…"/, "the phone search placeholder fits its box");

const calendar = read("./calendar-view.tsx");
assert.doesNotMatch(calendar, /Nothing scheduled upcoming/, "agenda empty copy is grammatical");
assert.match(
  calendar,
  /itemsLoadFailed \? \([\s\S]{0,120}Couldn't load reminders\.[\s\S]{0,400}Retry loading reminders[\s\S]{0,200}Nothing upcoming\./,
  "a failed reminders read says so with Retry before any empty copy",
);

const sidebar = read("./workspace-sidebar.tsx");
assert.match(
  sidebar,
  /!hasSearch && sessionsError \? \([\s\S]{0,120}role="alert"[\s\S]{0,160}Couldn&apos;t load chats[\s\S]{0,400}Retry loading chats/,
  "a failed sessions read says so with Retry instead of 'No conversations yet.'",
);

console.log("interface-copy-contract.test.ts: ok");
