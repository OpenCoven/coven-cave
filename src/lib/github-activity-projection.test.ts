import assert from "node:assert/strict";
import { linkCardsToItems } from "./github-activity-projection.ts";
import type { Card } from "./cave-board-types.ts";
import type { GitHubItem } from "./github-tasks.ts";

const item = (id: string, url: string): GitHubItem => ({
  kind: "pr", id, url, repo: "OpenCoven/coven-cave", title: id, updatedAt: "",
});
const card = (id: string, links: Array<{ id: string; url: string }>): Card => ({
  id,
  github: links,
} as Card);

const items = [
  item("PR-1", "https://github.com/OpenCoven/coven-cave/pull/1"),
  item("PR-2", "https://github.com/OpenCoven/coven-cave/pull/2"),
  item("unmatched", "https://github.com/OpenCoven/coven-cave/pull/3"),
];
const cards = [
  card("first", [{ id: "other", url: " HTTPS://GITHUB.COM/OPENCOVEN/COVEN-CAVE/PULL/1 " }]),
  card("second", [{ id: " pr-1 ", url: "elsewhere" }, { id: "pr-2", url: "elsewhere" }]),
  card("third", [{ id: "pr-1", url: items[0].url }]),
  card("empty", []),
];

const linked = linkCardsToItems(cards, items);
assert.deepEqual(linked.get("PR-1")?.map((entry) => entry.id), ["first", "second", "third"]);
assert.deepEqual(linked.get("PR-2")?.map((entry) => entry.id), ["second"]);
assert.deepEqual(linked.get("unmatched"), []);
assert.equal(linked.size, items.length);

// The view keys its map by item ID; when duplicate IDs appear, the last row wins.
const repeated = linkCardsToItems(cards, [items[0], item("PR-1", "different")]);
assert.deepEqual(repeated.get("PR-1")?.map((entry) => entry.id), ["second", "third"]);
