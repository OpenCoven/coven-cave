import assert from "node:assert/strict";
import test from "node:test";
import { selectSignedArtifact } from "./generate-latest-json.mjs";

test("signed artifact selection chooses the first signed match", () => {
  const assets = [
    "CovenCave_0.0.140_amd64.AppImage",
    "CovenCave_0.0.140_amd64.AppImage.sig",
  ];
  const sigs = new Set(assets.filter((name) => name.endsWith(".sig")));

  assert.equal(
    selectSignedArtifact(
      assets,
      (name) => name.endsWith(".AppImage"),
      (name) => sigs.has(`${name}.sig`),
    ),
    "CovenCave_0.0.140_amd64.AppImage",
  );
});

test("signed artifact selection skips unsigned matches", () => {
  const assets = [
    "CovenCave_0.0.140_unsigned.AppImage",
    "CovenCave_0.0.140_amd64.AppImage",
    "CovenCave_0.0.140_amd64.AppImage.sig",
  ];
  const sigs = new Set(assets.filter((name) => name.endsWith(".sig")));

  assert.equal(
    selectSignedArtifact(
      assets,
      (name) => name.endsWith(".AppImage"),
      (name) => sigs.has(`${name}.sig`),
    ),
    "CovenCave_0.0.140_amd64.AppImage",
  );
});
