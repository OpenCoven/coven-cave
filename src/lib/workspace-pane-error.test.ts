import assert from "node:assert/strict";
import { test } from "node:test";
import { workspacePaneErrorMessage, workspacePaneResetKey } from "./workspace-pane-error.ts";

test("pane errors expose safe recovery copy", () => {
  assert.equal(workspacePaneErrorMessage(new Error("Fetch failed")), "Fetch failed");
  assert.equal(workspacePaneErrorMessage("unavailable"), "Couldn't load this page. Try again.");
  assert.equal(workspacePaneErrorMessage({ secret: "do not expose" }), "Couldn't load this page. Try again.");
});

test("reset keys track the pane identity and page landmark", () => {
  assert.equal(workspacePaneResetKey("pane-1", "Tasks"), "pane-1:Tasks");
});
