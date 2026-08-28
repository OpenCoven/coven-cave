import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
  PROJECT_ROOT_WORKSPACE_HELP,
  projectRootRejectionMessage,
} from "./project-root-guidance.ts";

// cave-cu0x: the shared constants are the single source of the workspace
// requirement copy — the client must render these, never a parallel string.
test("the shared guidance constants stay stable", () => {
  assert.equal(
    PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
    "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE",
  );
  assert.equal(
    PROJECT_ROOT_WORKSPACE_HELP,
    "Project folders can live anywhere on this computer — any folder works except your home folder itself or the top of a drive.",
  );
  assert.equal(
    PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
    "Choose a specific folder for this project — your home folder itself or the top of a drive can't be a project root.",
  );
});

// The containment rejection must pair the server's error with the shared help
// so the user sees both what was rejected and what IS allowed.
test("the containment code composes the shared error with the workspace help", () => {
  assert.equal(
    projectRootRejectionMessage(
      PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
      PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
    ),
    `${PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR} ${PROJECT_ROOT_WORKSPACE_HELP}`,
  );
});

// Non-containment failures (missing root, invalid GitHub link, local-only
// rejections, …) must pass through untouched so their own guidance survives.
test("non-containment errors pass through unchanged", () => {
  assert.equal(
    projectRootRejectionMessage("local_request_required", "Project registration must happen from the Cave desktop."),
    "Project registration must happen from the Cave desktop.",
  );
  assert.equal(
    projectRootRejectionMessage(undefined, "root does not exist"),
    "root does not exist",
  );
});
