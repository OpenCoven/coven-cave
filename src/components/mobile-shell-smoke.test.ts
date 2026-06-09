// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const bottomTerminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const browserPane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

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
  workspace,
  /const showCompanionRail = railTab === "salem" \|\| \(mode !== "browser" && mode !== "agents"\);/,
  "Browser and Agents modes should suppress the desktop agent pane unless Salem is selected",
);
assert.match(
  workspace,
  /agentRail=\{showCompanionRail \? \(/,
  "Browser and Agents modes should suppress the desktop companion trigger rail",
);
