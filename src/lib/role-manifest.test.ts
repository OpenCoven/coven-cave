import assert from "node:assert/strict";
import { parseRoleListField, parseRoleMcpServers, setRoleListField } from "./role-manifest.ts";

const roleMd = `---
name: "Release Captain"
description: "Owns the release train"
familiar: nova
---

# Release Captain

skills:
- changelog-writer
- release-notes

workflows:
- nova-release-review

mcpServers:
- filesystem
- github

## Notes

Some prose that must survive edits.
`;

// --- parse ---
assert.deepEqual(parseRoleListField(roleMd, "workflows"), ["nova-release-review"]);
assert.deepEqual(parseRoleListField(roleMd, "skills"), ["changelog-writer", "release-notes"]);
assert.deepEqual(parseRoleListField(roleMd, "plugins"), [], "missing field parses as empty");
assert.deepEqual(parseRoleMcpServers(roleMd), ["filesystem", "github"], "mcpServers parses as a first-class role list");
assert.deepEqual(parseRoleMcpServers("mcp:\n- linear\n- vercel\n"), ["linear", "vercel"], "legacy mcp alias stays readable");
assert.deepEqual(parseRoleMcpServers("mcp_servers:\n- memory\n"), ["memory"], "snake_case mcp_servers alias stays readable");

// --- replace an existing block ---
const added = setRoleListField(roleMd, "workflows", ["nova-release-review", "sage-research-sweep"]);
assert.deepEqual(parseRoleListField(added, "workflows"), ["nova-release-review", "sage-research-sweep"]);
assert.deepEqual(parseRoleListField(added, "skills"), ["changelog-writer", "release-notes"], "other lists untouched");
assert.deepEqual(parseRoleMcpServers(added), ["filesystem", "github"], "mcp server lists survive unrelated edits");
assert.match(added, /Some prose that must survive edits\./, "surrounding prose survives");
assert.match(added, /name: "Release Captain"/, "frontmatter survives");

// --- remove a value ---
const removed = setRoleListField(added, "workflows", ["sage-research-sweep"]);
assert.deepEqual(parseRoleListField(removed, "workflows"), ["sage-research-sweep"]);

// --- empty list drops the block ---
const emptied = setRoleListField(roleMd, "workflows", []);
assert.deepEqual(parseRoleListField(emptied, "workflows"), []);
assert.doesNotMatch(emptied, /workflows:/, "empty list removes the block");
assert.match(emptied, /skills:/, "other blocks survive emptying");

// --- append when the field is missing ---
const noWorkflows = setRoleListField(roleMd, "workflows", []);
const appended = setRoleListField(noWorkflows, "workflows", ["fresh-flow"]);
assert.deepEqual(parseRoleListField(appended, "workflows"), ["fresh-flow"]);
assert.match(appended, /Some prose that must survive edits\./);

// --- idempotent ---
assert.equal(setRoleListField(added, "workflows", ["nova-release-review", "sage-research-sweep"]), added);

console.log("role-manifest.test.ts: ok");
