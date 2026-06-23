import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = "src/components/workflows";
const comp = readFileSync(`${root}/workflow-capability-attachments.tsx`, "utf8");
const panel = readFileSync(`${root}/workflow-attachments.tsx`, "utf8");

// The three attachment kinds plus the inherited roll-up are all present.
assert.match(comp, /title="Skills"/, "Skills section");
assert.match(comp, /title="MCP servers"/, "MCP section");
assert.match(comp, /title="API calls"/, "API calls section");
assert.match(comp, /title="Inherited permissions"/, "inherited permissions roll-up");

// Each kind persists through onUpdateMeta with the right field.
assert.match(comp, /onUpdateMeta\(\{ skills: toggle\(workflow\.skills, id\) \}\)/, "skills persist");
assert.match(comp, /onUpdateMeta\(\{ mcp: toggle\(workflow\.mcp, id\) \}\)/, "mcp persist");
assert.match(comp, /onUpdateMeta\(\{ http: next \}\)/, "api calls persist");

// Data sources are the live endpoints.
assert.match(comp, /fetch\("\/api\/skills\/local"\)/, "loads skills from /api/skills/local");
assert.match(comp, /fetch\("\/api\/mcp"\)/, "loads MCP servers from /api/mcp");

// Inheritance is computed and rendered with provenance.
assert.match(comp, /inheritedWorkflowPermissions\(workflow, resolveSkill\)/, "computes inherited permissions");
assert.match(comp, /via \{perm\.source\}/, "renders the inheriting source");

// The picker is a searchable popover; the API-call editor is a modal.
assert.match(comp, /<Popover\b/, "uses an anchored popover picker");
assert.match(comp, /<Modal\b/, "API call editor is a modal");
assert.match(comp, /web\.fetch/, "API calls note the web.fetch grant");

// The panel mounts the capability sections for the selected workflow.
assert.match(panel, /import \{ WorkflowCapabilityAttachments \}/, "panel imports the capability sections");
assert.match(panel, /<WorkflowCapabilityAttachments workflow=\{workflow\} onUpdateMeta=\{onUpdateMeta\} \/>/, "panel renders them for the selected workflow");

console.log("workflow-capability-attachments.test.ts: ok");
