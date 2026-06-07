// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cardMatchesBoardSearch,
  parseBoardSearchQuery,
} from "./board-search.ts";

const card = {
  id: "card-1",
  title: "Board card drag between columns",
  notes: "Use dnd-kit or native drag events.",
  status: "inbox",
  priority: "medium",
  familiarId: "cody",
  sessionId: "session-1",
  cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  links: ["https://github.com/OpenCoven/coven-cave/pull/153"],
  github: [{
    id: "github:pr:opencoven/coven-cave:153",
    kind: "pr",
    repo: "OpenCoven/coven-cave",
    number: 153,
    title: "Board table GitHub task field",
    url: "https://github.com/OpenCoven/coven-cave/pull/153",
    state: "open",
    labels: ["ui"],
  }],
  labels: ["ux", "board", "drag"],
};

const familiarsById = new Map([
  ["cody", { id: "cody", display_name: "Cody" }],
]);

assert.deepEqual(parseBoardSearchQuery('drag label:ux status:inbox -priority:urgent'), [
  { key: null, value: "drag", negated: false },
  { key: "label", value: "ux", negated: false },
  { key: "status", value: "inbox", negated: false },
  { key: "priority", value: "urgent", negated: true },
]);

assert.equal(cardMatchesBoardSearch(card, "", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "drag ux", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "label:ux status:inbox familiar:cody", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, 'title:"between columns" -label:backend', familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "cwd:coven-cave link:github.com", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "path:OpenCoven url:pull/153", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "github:table gh:153", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "session:session-1", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "pull/153", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "coven-cave", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "is:open", familiarsById), true);
assert.equal(cardMatchesBoardSearch({ ...card, status: "done" }, "is:closed", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "is:closed", familiarsById), false);
assert.equal(cardMatchesBoardSearch(card, "label:backend", familiarsById), false);
assert.equal(cardMatchesBoardSearch(card, "priority:urgent", familiarsById), false);

const boardTypes = await readFile(new URL("./cave-board-types.ts", import.meta.url), "utf8");
assert.match(boardTypes, /cwd: string \| null/, "Task cards should persist cwd");
assert.match(boardTypes, /links: string\[\]/, "Task cards should persist links");
assert.match(boardTypes, /github: CardGitHubLink\[\]/, "Task cards should persist GitHub connections");

const boardStore = await readFile(new URL("./cave-board.ts", import.meta.url), "utf8");
assert.match(boardStore, /mergeLinksWithGitHub\(normalizeLinks/, "Task persistence should normalize links");
assert.match(boardStore, /cwd: normalizeCwd/, "Task persistence should normalize cwd");

const boardApi = await readFile(new URL("../app/api/board/route.ts", import.meta.url), "utf8");
assert.match(boardApi, /links\?: string\[\]/, "Create API should accept task links");
assert.match(boardApi, /cwd\?: string \| null/, "Create API should accept task cwd");

const boardView = await readFile(new URL("../components/board-view.tsx", import.meta.url), "utf8");
assert.match(boardView, /board-search-input/, "Tasks header should expose one search input");
assert.doesNotMatch(boardView, /label="Labels"/, "Tasks header should not show Labels as a separate filter control");
assert.doesNotMatch(boardView, /allLabels/, "Tasks view should not build a dedicated labels filter row");

const newCardModal = await readFile(new URL("../components/new-card-modal.tsx", import.meta.url), "utf8");
assert.match(newCardModal, /label="CWD"/, "New task modal should include cwd");
assert.match(newCardModal, /label="Links"/, "New task modal should include links");
assert.match(newCardModal, /label="Session \(optional\)"/, "New task modal should mark session optional");

const boardInspector = await readFile(new URL("../components/board-inspector.tsx", import.meta.url), "utf8");
assert.match(boardInspector, /link-item-anchor/, "Task inspector should render task links");
assert.match(boardInspector, /card\.sessionId/, "Task inspector should render task session context");
