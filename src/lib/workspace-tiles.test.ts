import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SECONDARY_WORKSPACE_TILES,
  addSecondaryWorkspaceTile,
  removeSecondaryWorkspaceTile,
  workspaceTileVariant,
} from "./workspace-tiles.ts";
import type { WorkspacePaneRequest } from "./workspace-pane-request.ts";
import {
  normalizeWorkspacePaneRequest,
  workspacePaneRequestKey,
} from "./workspace-pane-request.ts";

type Tile = { id: string };
const keyOf = (tile: Tile) => tile.id;

function paneRequest(instanceId: string, pageId: string): WorkspacePaneRequest {
  const request = normalizeWorkspacePaneRequest(instanceId, pageId);
  assert.ok(request);
  return request;
}

test("addSecondaryWorkspaceTile evicts the oldest unique tile at the 3-secondary cap", () => {
  const tiles = [{ id: "library" }, { id: "github" }, { id: "board" }];
  const next = addSecondaryWorkspaceTile(tiles, { id: "journal" }, keyOf);

  assert.equal(MAX_SECONDARY_WORKSPACE_TILES, 3);
  assert.deepEqual(next.map((tile) => tile.id), ["github", "board", "journal"]);
});

test("addSecondaryWorkspaceTile moves an existing tile to the most recent position", () => {
  const tiles = [{ id: "library" }, { id: "github" }, { id: "board" }];
  const next = addSecondaryWorkspaceTile(tiles, { id: "library" }, keyOf);

  assert.deepEqual(next.map((tile) => tile.id), ["github", "board", "library"]);
});

test("removeSecondaryWorkspaceTile removes one tile by key", () => {
  const next = removeSecondaryWorkspaceTile(
    [{ id: "library" }, { id: "github" }, { id: "board" }],
    "github",
    keyOf,
  );

  assert.deepEqual(next.map((tile) => tile.id), ["library", "board"]);
});

test("normalized pane requests replace and move an exact canonical page variant", () => {
  const firstGroup = paneRequest("group-first", "groupchat");
  const directChat = paneRequest("chat-direct", "chat");
  const board = paneRequest("board-primary", "board");
  const replacementGroup = paneRequest("group-replacement", "groupchat");

  const next = addSecondaryWorkspaceTile(
    [firstGroup, directChat, board],
    replacementGroup,
    workspacePaneRequestKey,
  );

  assert.deepEqual(next.map(({ instanceId }) => instanceId), [
    "chat-direct",
    "board-primary",
    "group-replacement",
  ]);
  assert.equal(
    next.filter((request) => workspacePaneRequestKey(request) === "chat:group").length,
    1,
  );
});

test("direct Chat and Group pane requests coexist as distinct variants", () => {
  const directChat = paneRequest("chat-direct", "chat");
  const group = paneRequest("chat-group", "groupchat");

  const next = addSecondaryWorkspaceTile([directChat], group, workspacePaneRequestKey);

  assert.deepEqual(next.map(workspacePaneRequestKey), ["chat:default", "chat:group"]);
  assert.deepEqual(next.map(({ instanceId }) => instanceId), ["chat-direct", "chat-group"]);
});

test("normalized requests retain the newest instance while respecting the tile cap", () => {
  const directChat = paneRequest("chat-oldest", "chat");
  const group = paneRequest("group-middle", "groupchat");
  const board = paneRequest("board-middle", "board");
  const researcher = paneRequest("researcher-newest", "surface:researcher");

  const next = addSecondaryWorkspaceTile(
    [directChat, group, board],
    researcher,
    workspacePaneRequestKey,
  );

  assert.equal(MAX_SECONDARY_WORKSPACE_TILES, 3);
  assert.equal(next.length, 3);
  assert.deepEqual(next.map(({ instanceId }) => instanceId), [
    "group-middle",
    "board-middle",
    "researcher-newest",
  ]);
  assert.deepEqual(next.map(workspacePaneRequestKey), [
    "chat:group",
    "board:default",
    "surface:researcher:default",
  ]);
});

test("removeSecondaryWorkspaceTile removes a normalized request by canonical key", () => {
  const directChat = paneRequest("chat-retained", "chat");
  const group = paneRequest("group-removed", "groupchat");
  const board = paneRequest("board-retained", "board");

  const next = removeSecondaryWorkspaceTile(
    [directChat, group, board],
    workspacePaneRequestKey(group),
    workspacePaneRequestKey,
  );

  assert.deepEqual(next.map(({ instanceId }) => instanceId), [
    "chat-retained",
    "board-retained",
  ]);
  assert.deepEqual(next.map(workspacePaneRequestKey), ["chat:default", "board:default"]);
});

test("workspaceTileVariant names the optimized layout for each visible page count", () => {
  assert.equal(workspaceTileVariant(1), "single");
  assert.equal(workspaceTileVariant(2), "split");
  assert.equal(workspaceTileVariant(3), "triad");
  assert.equal(workspaceTileVariant(4), "quad");
  assert.equal(workspaceTileVariant(7), "quad");
});
