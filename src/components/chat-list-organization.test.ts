// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Source-contract pins for the organization level in the chat list's
// "Group by project" mode (cave-1vpy). The live chat surface was redesigned
// away from the org-grouped rail (#5099), so the derived-organization
// grouping now renders in the list: org headers above project folders, with
// the "(no project)" bucket last via the shared chatProjectOrganizationGroups
// sort. These pins keep the wiring visible to the suite.

const src = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

test("chat-list imports the organization grouping helper", () => {
  assert.match(
    src,
    /import \{\s*\n\s*NO_PROJECT_ORGANIZATION,\s*\n\s*chatProjectOrganizationGroups,\s*\n\} from "@\/lib\/project-organizations"/,
    "chat-list should import chatProjectOrganizationGroups and NO_PROJECT_ORGANIZATION from the shared org module",
  );
});

test("chat-list makes project groups org-major in Group by project mode", () => {
  assert.match(
    src,
    /if \(groupBy === "project"\) \{\s*\n\s*ordered = chatProjectOrganizationGroups\(ordered\)\.flatMap\(\(orgGroup\) => orgGroup\.items\);/,
    "Group by project should reorder the project folders under their derived organization (org-major, no-project last)",
  );
  assert.match(
    src,
    /organizationProjectCounts\s*=\s*useMemo\([\s\S]{0,200}?if \(groupBy !== "project"\) return null;/,
    "the org project counts should only be derived in Group by project mode",
  );
});

test("chat-list renders one organization header per org, above the project folders", () => {
  assert.match(
    src,
    /const showOrganizationHeader =\s*\n\s*groupBy === "project"\s*\n\s*&& \(groupIndex === 0 \|\| organization\.key !== displayGroups\[groupIndex - 1\]\.organization\.key\);/,
    "an organization header should render only when the org key changes (once per org in the org-major list)",
  );
  assert.match(
    src,
    /<li className="chat-list-org-header" aria-label=\{organization\.label\}>/,
    "the org header should be an accessible li labelled with the org name",
  );
  assert.match(
    src,
    /\{organizationProjectCounts\?\.get\(organization\.key\) \?\? 0\}/,
    "the org header should show its project count",
  );
});

test("chat-list keeps the flat and date views free of org headers", () => {
  assert.match(
    src,
    /showOrganizationHeader \? \(\s*\n\s*<li className="chat-list-org-header"/,
    "org headers are conditional on showOrganizationHeader",
  );
  assert.doesNotMatch(
    src,
    /chat-list-org-header[^\n]*\{\s*\n/,
    "org headers should never render unconditionally",
  );
});

console.log("chat-list-organization.test.ts: ok");
