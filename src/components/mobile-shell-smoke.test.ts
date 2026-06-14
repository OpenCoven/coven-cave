// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const bottomTerminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const browserPane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  bottomTerminal,
  /Running outside Tauri|Only mounts inside the Tauri webview/,
  "Terminal should keep a browser-safe path for mobile web access",
);

assert.match(
  browserPane,
  /outside Tauri|fallback iframe|window\.open/,
  "Browser view should keep a browser fallback path outside the desktop webview",
);

assert.match(
  globals,
  /Those tabs live in normal shell flow[\s\S]{0,220}\.shell-detail\s*\{[\s\S]{0,80}padding-bottom:\s*0;/,
  "Mobile shell detail should not reserve extra space above bottom tabs",
);

assert.match(
  workspace,
  /railTab === "browser" \|\| railTab === "salem" \|\| \(mode !== "browser" && mode !== "agents"\)/,
  "Browser and Agents modes suppress the default companion pane unless a floating Browser or Salem tab is selected",
);
assert.match(
  workspace,
  /familiarPanelRail=\{showCompanionRail \? \(/,
  "Browser and Agents modes should suppress the desktop companion trigger rail unless a floating rail tab is selected",
);
