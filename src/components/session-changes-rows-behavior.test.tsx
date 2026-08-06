import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { FileRow } from "./session-changes-rows";

function renderRow(revertible: boolean): string {
  return renderToStaticMarkup(
    createElement(
      "table",
      null,
      createElement(
        "tbody",
        null,
        createElement(FileRow, {
          file: {
            path: revertible
              ? "packages/app/src/a.ts"
              : "packages/sibling/src/a.ts",
            status: "modified",
            revertible,
          },
          expanded: false,
          diffState: undefined,
          reverting: false,
          onToggle: () => {},
          onRevert: () => {},
        }),
      ),
    ),
  );
}

test("in-project file rows expose Undo while outside-project rows are read only", () => {
  const inProject = renderRow(true);
  assert.match(inProject, /aria-label="Revert packages\/app\/src\/a\.ts"/);
  assert.doesNotMatch(inProject, />Read only</);

  const outsideProject = renderRow(false);
  assert.doesNotMatch(outsideProject, /aria-label="Revert /);
  assert.match(outsideProject, />Read only</);
  assert.match(outsideProject, /title="Outside this project"/);
});
