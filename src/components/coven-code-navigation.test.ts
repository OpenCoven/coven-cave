// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const daemonBar = await readFile(new URL("./daemon-bar.tsx", import.meta.url), "utf8");
const comuxView = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");

assert.match(
  sidebar,
  /\{ id: "agents",\s+label: "Agents"/,
  "Sidebar should expose Agents as the first-class familiar work destination",
);

assert.doesNotMatch(
  sidebar,
  /\{ id: "chats",\s+label: "Chat"/,
  "Sidebar should no longer expose Chat as a separate top-level destination",
);

assert.doesNotMatch(
  sidebar,
  /\{ id: "calls",\s+label: "Coven Calls"/,
  "Sidebar should fold the Floor and delegation graph into Agents instead of a separate Calls tab",
);

assert.match(
  sidebar,
  /\{ id: "terminal",\s+label: "Terminal"/,
  "Sidebar should expose Terminal as a first-class destination",
);

assert.doesNotMatch(
  sidebar,
  /label: "Coven Code"/,
  "Sidebar should not collapse Terminal and Projects behind Coven Code",
);

assert.doesNotMatch(
  sidebar,
  /sidebar-familiar-list|familiars\.map/,
  "Sidebar should not render familiar/agent rows",
);

assert.doesNotMatch(
  sidebar,
  /Collapse sidebar|sidebar-collapse-btn|onCollapse/,
  "Sidebar should not render its own collapse row; the shell nav tab is the single sidebar toggle",
);

assert.match(
  daemonBar,
  /terminal: "Terminal"/,
  "Top bar should label Terminal mode",
);

assert.match(
  daemonBar,
  /projects: "Projects"/,
  "Top bar should label Projects mode",
);

assert.match(
  workspace,
  /mode === "agents"[\s\S]*<AgentsView/,
  "Workspace should route Agents to the integrated AgentsView",
);

assert.match(
  workspace,
  /import \{ AgentsView \} from "@\/components\/agents-view";/,
  "Workspace should import the integrated AgentsView",
);

assert.match(
  workspace,
  /const \[shellAgentPane,\s*setShellAgentPane\] = useState<"browser" \| "chat">\("browser"\)/,
  "Workspace should keep the shell chat sidepanel state separate from Agents view state",
);

assert.match(
  workspace,
  /shellAgentPane === "chat" \? \([\s\S]*<AgentPanel[\s\S]*\) : \([\s\S]*<BrowserPane label="default" \/>/,
  "Workspace should render chat directly in the shell sidepanel instead of routing through Agents",
);

assert.doesNotMatch(
  workspace,
  /aria-label=\{shellAgentPane === "chat" \? "Close chat panel" : "Open chat panel"\}[\s\S]{0,240}setMode\("agents"\)/,
  "Chat sidepanel toggle should not navigate to the Agents page",
);

assert.match(
  workspace,
  /mode === "terminal"[\s\S]*<ComuxView[\s\S]*view="terminal"/,
  "Workspace should route Terminal to ComuxView terminal mode",
);

assert.match(
  workspace,
  /mode === "projects"[\s\S]*<ComuxView[\s\S]*view="projects"/,
  "Workspace should route Projects to ComuxView projects mode",
);

assert.match(
  comuxView,
  /type ComuxViewMode = "terminal" \| "projects"/,
  "ComuxView should have explicit Terminal and Projects modes",
);
