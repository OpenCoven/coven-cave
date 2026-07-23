// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source contracts for the per-project settings sheet (Chat → Projects rows):
// it ties a project to a GitHub repository through the shared repo-link
// normalizer, persisting only the canonical https link via the caller's
// updateRepoUrl (PUT /api/projects/[id]). The normalizer itself is
// behaviorally tested in src/lib/github-repo-link.test.ts.

const modal = readFileSync(new URL("./project-settings-modal.tsx", import.meta.url), "utf8");

test("the sheet is the shared Modal, named for the project", () => {
  assert.match(modal, /import \{ Modal \} from "@\/components\/ui\/modal"/, "uses the focus-trapping Modal primitive");
  assert.match(modal, /breadcrumb=\{\["Projects", project\.name\]\}/, "breadcrumb names the project being edited");
  assert.match(modal, /if \(!project\) return null;/, "renders nothing while closed");
});

test("input normalizes before save and rejects non-GitHub links client-side", () => {
  assert.match(
    modal,
    /import \{ gitHubRepoSlug, normalizeGitHubRepoUrl \} from "@\/lib\/github-repo-link"/,
    "validation goes through the shared normalizer — the same one the API enforces",
  );
  assert.match(modal, /const normalized = trimmed \? normalizeGitHubRepoUrl\(trimmed\) : null;/, "normalizes the draft");
  assert.match(
    modal,
    /if \(trimmed && !normalized\) \{[\s\S]{0,200}doesn’t look like a GitHub repository/,
    "invalid input errors locally instead of round-tripping a doomed PUT",
  );
  assert.match(
    modal,
    /await onSaveRepoUrl\(project\.id, trimmed \? normalized : null\)/,
    "saves the canonical link — an emptied field unlinks with null",
  );
  assert.match(modal, /placeholder="owner\/repo or https:\/\/github\.com\/owner\/repo"/, "placeholder teaches both spellings");
  assert.match(modal, /if \(e\.key === "Enter"\)/, "Enter submits from the field");
});

test("the linked repository is visible and opens safely", () => {
  assert.match(modal, /gitHubRepoSlug\(project\.repoUrl\)/, "shows the owner/repo slug, not the raw URL");
  assert.match(modal, /target="_blank"[\s\S]{0,40}rel="noreferrer"/, "external link carries rel=noreferrer");
  assert.match(modal, /ph:github-logo/, "GitHub glyph marks the link");
});

test("edit state re-seeds per project and failures announce themselves", () => {
  assert.match(modal, /useEffect\(\(\) => \{[\s\S]{0,120}setDraft\(projectRepoUrl\);/, "reopening a different project reseeds the field");
  assert.match(modal, /Couldn’t save the repository link\./, "server failures surface in the sheet");
  assert.match(modal, /role="alert"/, "errors are announced");
  assert.match(modal, /loading=\{saving\}/, "the save button reflects the in-flight PUT");
});

console.log("project-settings-modal.test.ts: ok");
