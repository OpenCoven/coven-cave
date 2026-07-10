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
  cwd: "/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
  projectId: "coven-cave",
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
assert.match(boardTypes, /projectId\?: string \| null/, "Task cards should persist projectId");
assert.match(boardTypes, /links: string\[\]/, "Task cards should persist links");
assert.match(boardTypes, /github: CardGitHubLink\[\]/, "Task cards should persist GitHub connections");

const boardStore = await readFile(new URL("./cave-board.ts", import.meta.url), "utf8");
assert.match(boardStore, /mergeLinksWithGitHub\(normalizeLinks/, "Task persistence should normalize links");
assert.match(boardStore, /cwd: normalizeCwd/, "Task persistence should normalize cwd");
assert.match(boardStore, /projectId: "projectId" in patch/, "Task persistence should patch projectId");

const boardApi = await readFile(new URL("../app/api/board/route.ts", import.meta.url), "utf8");
assert.match(boardApi, /links\?: string\[\]/, "Create API should accept task links");
assert.match(boardApi, /cwd\?: string \| null/, "Create API should accept task cwd");
assert.match(boardApi, /projectId\?: string \| null/, "Create API should accept task projectId");

// cave-pw83: a card's cwd is derived server-side from its assigned project, never
// trusted from the client body (a mismatched cwd would poison board search/display).
const projectsLib = await readFile(new URL("./cave-projects.ts", import.meta.url), "utf8");
assert.match(projectsLib, /export async function trustedProjectCwd/, "cave-projects exposes a server-trusted cwd resolver");
assert.match(boardApi, /trustedProjectCwd\(body\.projectId\)/, "Create API resolves the assigned project's cwd server-side");
assert.match(boardApi, /cwd = resolved\.root/, "Create API stores the server-resolved project root as cwd, not the client's");

const boardIdApi = await readFile(new URL("../app/api/board/[id]/route.ts", import.meta.url), "utf8");
assert.match(boardIdApi, /trustedProjectCwd\(body\.projectId\)/, "PATCH API derives cwd when a project is (re)assigned");
assert.match(
  boardIdApi,
  /body\.cwd !== undefined && body\.projectId === undefined[\s\S]*?trustedProjectCwd\(current\.projectId\)/,
  "PATCH API re-derives cwd from the card's current project when cwd changes alone (no client override)",
);

const boardView = await readFile(new URL("../components/board-view.tsx", import.meta.url), "utf8");
assert.match(boardView, /board-search-input/, "Tasks header should expose one search input");
assert.doesNotMatch(boardView, /label="Labels"/, "Tasks header should not show Labels as a separate filter control");
assert.doesNotMatch(boardView, /allLabels/, "Tasks view should not build a dedicated labels filter row");

const newCardModal = await readFile(new URL("../components/new-card-modal.tsx", import.meta.url), "utf8");
assert.doesNotMatch(newCardModal, /label="CWD"/, "New task modal should not expose a raw cwd field — the project picker drives cwd");
assert.match(newCardModal, /cwd: selectedProject\?\.root \?\? null/, "New task modal derives cwd from the selected project");
assert.match(newCardModal, /label="Links"/, "New task modal should include links");
assert.match(newCardModal, /label="Session \(optional\)"/, "New task modal should mark session optional");

const boardInspector = await readFile(new URL("../components/board-inspector.tsx", import.meta.url), "utf8");
assert.match(boardInspector, /link-item-anchor/, "Task inspector should render task links");
assert.match(boardInspector, /card\.sessionId/, "Task inspector should render task session context");
assert.match(boardInspector, /<div className="board-drawer-field-label board-drawer-field-label--split">[\s\S]{0,120}<span>Project<\/span>/, "Task inspector should expose the task project selector");
assert.match(boardInspector, /onPatch\(card\.id, \{ projectId: selectedProject\?\.id \?\? null, cwd: selectedProject\?\.root \?\? null \}\)/, "Task project changes should set the persisted cwd");
assert.doesNotMatch(boardInspector, /function openCwdInExplorer|aria-label="Open CWD in directory explorer"/, "Task inspector should not expose a separate CWD open action");
