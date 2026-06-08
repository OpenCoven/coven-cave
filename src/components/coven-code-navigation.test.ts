// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const comuxView = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");

assert.match(
  sidebar,
  /\{ id: "agents",\s+label: "Chats"/,
  "Sidebar should expose Chats as the first-class familiar chat destination",
);

assert.match(
  sidebar,
  /\{ id: "sessions",\s+label: "Sessions"/,
  "Sidebar should expose Sessions as a cross-harness session destination",
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

// The top header row was retired in favor of consolidating its affordances into
// the sidebar. Search lives at the top of the sidebar, Settings + Notifications
// at the bottom, and no horizontal DaemonBar is rendered.

assert.match(
  sidebar,
  /onOpenSearch:\s*\(\)\s*=>\s*void/,
  "Sidebar should accept a search-open action now that search lives in the sidebar",
);

assert.match(
  sidebar,
  /onOpenSettings:\s*\(\)\s*=>\s*void/,
  "Sidebar should accept a settings-open action now that settings lives in the sidebar footer",
);

assert.match(
  sidebar,
  /NotificationBell/,
  "Sidebar should be capable of rendering the notification bell in its footer",
);

assert.match(
  sidebar,
  /label="Search"/,
  "Sidebar should expose a Search action row at the top",
);

assert.doesNotMatch(
  workspace,
  /<DaemonBar/,
  "Workspace should no longer render the DaemonBar top header",
);

assert.doesNotMatch(
  workspace,
  /topBar=\{/,
  "Workspace should not pass a topBar prop to Shell after chrome consolidation",
);

assert.match(
  workspace,
  /onOpenSearch=\{\(\)\s*=>\s*setPaletteOpen\(true\)\}/,
  "Workspace should wire the sidebar Search action to the command palette",
);

assert.match(
  workspace,
  /onOpenSettings=\{\(\)\s*=>\s*nextRouter\.push\("\/settings"\)\}/,
  "Workspace should wire the sidebar Settings action to the /settings route",
);

assert.match(
  workspace,
  /onNotificationPrefsChanged=\{refreshPrefs\}/,
  "Workspace should pass notification-prefs callback through to the sidebar",
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
  /shellAgentPane === "chat" \? \([\s\S]*<AgentPanel[\s\S]*\) : \([\s\S]*<BrowserPane[\s\S]*label="default"[\s\S]*\/>/,
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

assert.doesNotMatch(
  workspace,
  /bottom=\{<BottomTerminal[\s\S]*threadId="cave\.bottom\.main"[\s\S]*\/>\}/,
  "Workspace should not mount a persistent bottom terminal outside the dedicated Terminal page",
);

assert.doesNotMatch(
  workspace,
  /import \{ BottomTerminal \} from "@\/components\/bottom-terminal";/,
  "Workspace should not import BottomTerminal when the terminal only lives in ComuxView",
);

assert.match(
  comuxView,
  /<BottomTerminal[\s\S]*threadId=\{`cave\.comux\.\$\{s\.id\}`\}/,
  "ComuxView should keep BottomTerminal for dedicated Terminal page sessions",
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
