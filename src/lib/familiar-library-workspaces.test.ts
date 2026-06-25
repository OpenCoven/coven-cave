import assert from "node:assert/strict";
import path from "node:path";
import { parseFamiliarLibraryWorkspaces } from "./familiar-library-workspaces.ts";

const workspaces = parseFamiliarLibraryWorkspaces(
  `
[[familiar]]
id = "researcher"
display_name = "Researcher"
icon = "ph:book-open"
workspace = "/tmp/researcher"

[[familiar]]
id = "builder"
display_name = "Builder"
`,
  { workspacesRoot: "/tmp/coven/workspaces/familiars" },
);

assert.deepEqual(workspaces, [
  {
    id: "researcher",
    name: "Researcher",
    icon: "ph:book-open",
    root: "/tmp/researcher",
  },
  {
    id: "builder",
    name: "Builder",
    icon: "ph:robot",
    root: path.join("/tmp/coven/workspaces/familiars", "builder"),
  },
]);

assert.deepEqual(parseFamiliarLibraryWorkspaces("", { workspacesRoot: "/tmp/root" }), []);

console.log("familiar-library-workspaces.test.ts OK");
