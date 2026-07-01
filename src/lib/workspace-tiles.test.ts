import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SECONDARY_WORKSPACE_TILES,
  addSecondaryWorkspaceTile,
  removeSecondaryWorkspaceTile,
  workspaceTileVariant,
} from "./workspace-tiles.ts";

type Tile = { id: string };
const keyOf = (tile: Tile) => tile.id;

test("addSecondaryWorkspaceTile appends unique tiles up to the 3-secondary cap", () => {
  const tiles = [{ id: "library" }, { id: "github" }, { id: "board" }];
  const next = addSecondaryWorkspaceTile(tiles, { id: "journal" }, keyOf);

  assert.equal(MAX_SECONDARY_WORKSPACE_TILES, 3);
  assert.deepEqual(next.map((tile) => tile.id), ["library", "github", "journal"]);
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

test("workspaceTileVariant names the optimized layout for each visible page count", () => {
  assert.equal(workspaceTileVariant(1), "single");
  assert.equal(workspaceTileVariant(2), "split");
  assert.equal(workspaceTileVariant(3), "triad");
  assert.equal(workspaceTileVariant(4), "quad");
  assert.equal(workspaceTileVariant(7), "quad");
});
