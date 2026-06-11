// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-graph-3d.tsx", import.meta.url), "utf8");

assert.match(source, /import \* as THREE from "three"/, "LibraryGraph3D should use Three.js");
assert.match(source, /OrbitControls/, "LibraryGraph3D should expose real orbit maneuvering");
assert.match(source, /resetCameraRef/, "LibraryGraph3D should provide a reset camera control");
assert.match(source, /focusSelectedRef/, "LibraryGraph3D should provide a focus selected control");
assert.match(source, /buildGraphSnapshotBTree/, "LibraryGraph3D should order snapshots with the btree helper");
assert.match(source, /rangeGraphSnapshots/, "LibraryGraph3D should render a target-path time-series range");
assert.match(source, /data-testid="library-graph-3d-canvas"/, "LibraryGraph3D should expose a stable canvas test hook");
assert.match(source, /data-testid="library-graph-snapshot-strip"/, "LibraryGraph3D should expose a stable snapshot strip hook");

console.log("library-graph-3d.test.ts: ok");
