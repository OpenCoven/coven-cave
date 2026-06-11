// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const pluginsView = await readFile(new URL("./plugins-view.tsx", import.meta.url), "utf8");
const workspaceMode = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");

assert.match(
  workspaceMode,
  /\|\s*"roles"/,
  "Roles should be a first-class workspace mode",
);

assert.match(
  sidebar,
  /\{ id: "roles", label: "Roles"[\s\S]*group: "tools"/,
  "Roles should appear in the main sidebar Tools group",
);

assert.match(
  sidebar,
  /\{ id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools" \}/,
  "Sidebar navigation should expose Roles as a tools surface",
);

assert.match(
  workspace,
  /mode === "roles"[\s\S]*<PluginsView[\s\S]*tabs=\{\["roles", "workflows", "plugins", "skills"\]\}/,
  "The Roles surface should expose roles, workflows, plugins, and skills",
);

assert.doesNotMatch(
  settings,
  /PluginsView/,
  "Settings must not render PluginsView — plugins and skills live on the Roles page",
);

assert.doesNotMatch(
  settings,
  /"plugins"/,
  "Settings must not declare a plugins section",
);

assert.match(
  pluginsView,
  /tabs\?: Tab\[\]/,
  "PluginsView should support caller-selected tab sets",
);
