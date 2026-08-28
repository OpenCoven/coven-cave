import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isProjectRootOutsideAllowedWorkspace,
} from "./project-root-workspace-notice.tsx";
import { PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE } from "../lib/project-root-guidance.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const notice = read("./project-root-workspace-notice.tsx");

// The shared notice renders the actionable containment error inline at every
// project entry point where creation/grant can fail (cave-cu0x). The server
// half already returns the error text; the client half must (a) surface the
// workspace-help copy proactively in the creation surface and (b) render the
// returned out-of-workspace error inline instead of a generic failure.

test("the notice recognizes the out-of-workspace containment code", () => {
  assert.equal(
    isProjectRootOutsideAllowedWorkspace(PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE),
    true,
    "the shared code is recognized",
  );
  assert.equal(isProjectRootOutsideAllowedWorkspace(null), false, "absent code is not a workspace failure");
  assert.equal(isProjectRootOutsideAllowedWorkspace(undefined), false, "undefined code is not a workspace failure");
  assert.equal(isProjectRootOutsideAllowedWorkspace("some_other_code"), false, "foreign codes are not workspace failures");
  assert.equal(isProjectRootOutsideAllowedWorkspace(""), false, "empty code is not a workspace failure");
});

test("the notice renders the canonical error for the workspace code and the generic error otherwise", () => {
  assert.match(notice, /from "@\/lib\/project-root-guidance"/, "imports the shared guidance module");
  assert.match(
    notice,
    /PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,\s*PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR/,
    "imports both the code and the canonical error copy",
  );
  assert.match(
    notice,
    /isProjectRootOutsideAllowedWorkspace\(code\) \? PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR : error/,
    "the workspace failure renders the canonical containment error, anything else the generic copy",
  );
  assert.match(notice, /role="alert"/, "the notice is assertive");
  assert.match(notice, /as: Tag = "p"/, "callers can render the notice as a paragraph or a span");
  assert.match(notice, /as\?: "p" \| "span"/, "the element choice is constrained to p/span");
});

test("the picker modal surfaces PROJECT_ROOT_WORKSPACE_HELP before a root is chosen", () => {
  const picker = read("./directory-picker-modal.tsx");
  assert.match(
    picker,
    /from "@\/lib\/project-root-guidance"/,
    "the creation surface imports the shared guidance module",
  );
  assert.match(
    picker,
    /PROJECT_ROOT_WORKSPACE_HELP/,
    "the picker references the workspace-help copy",
  );
  assert.match(
    picker,
    /className="directory-picker-workspace-help[^"]*"[\s\S]*\{PROJECT_ROOT_WORKSPACE_HELP\}/,
    "the help copy is rendered inline, before any folder is selected",
  );
});

test("the first-project gate also explains the workspace requirement proactively", () => {
  const gate = read("./first-project-gate.tsx");
  assert.match(gate, /PROJECT_ROOT_WORKSPACE_HELP/, "the gate surfaces the workspace-help copy");
  assert.match(
    gate,
    /first-project-gate-workspace-help[^"]*"[\s\S]*\{PROJECT_ROOT_WORKSPACE_HELP\}/,
    "the gate renders the help inline beside the manual root entry",
  );
});

test("the shared add-project flow threads the server failure code to every render site", () => {
  const picker = read("./project-picker.tsx");
  assert.match(picker, /addErrorCode: string \| null;/, "the flow exposes the stable server code");
  assert.match(picker, /setAddErrorCode\(result\.code \?\? null\);/, "the code is captured from the addChatProject result");
  for (const file of [
    "./project-picker.tsx",
    "./familiar-studio-projects-tab.tsx",
    "./chat-view.tsx",
    "./projects-view.tsx",
    "./composer-context-pill.tsx",
  ]) {
    const src = read(file);
    assert.match(
      src,
      /from "@\/components\/project-root-workspace-notice"/,
      `${file} imports the shared notice`,
    );
    assert.match(
      src,
      /<ProjectRootWorkspaceNotice[\s\S]*code=\{([^}]*addErrorCode)\}/,
      `${file} renders the notice with the failure code`,
    );
  }
});

test("standalone creation entry points thread the code into the notice too", () => {
  for (const file of [
    "./first-project-gate.tsx",
    "./project-setup-modal.tsx",
    "./canvas-github-import-modal.tsx",
  ]) {
    const src = read(file);
    assert.match(
      src,
      /from "@\/components\/project-root-workspace-notice"/,
      `${file} imports the shared notice`,
    );
    assert.match(
      src,
      /<ProjectRootWorkspaceNotice[\s\S]*code=\{(submit)?[eE]rrorCode\}/,
      `${file} renders the notice with its captured failure code`,
    );
    assert.match(
      src,
      /set(Submit)?ErrorCode\(projectErrorCode\((error|caught)\)(\s*\?\?\s*null)?\)/,
      `${file} captures the server code from the thrown creation failure`,
    );
  }
});
