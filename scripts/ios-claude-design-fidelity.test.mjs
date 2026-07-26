import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The authoritative Claude Design handoff is broader than a palette pass. This
// contract pins the iOS seams that previously regressed or shipped as static
// mock state: the supplied empty-session start page, global navigation,
// familiar discovery/detail, real response controls, live plugins, and the
// authored task/table affordances.

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const chat = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const chrome = await read("apps/ios/CovenCave/CovenCave/Theme/ChatChrome.swift");
const home = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");
const root = await read("apps/ios/CovenCave/CovenCave/Views/RootView.swift");
const familiars = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarsListView.swift");
const plugins = await read("apps/ios/CovenCave/CovenCave/Views/PluginsPanel.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const appModel = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const tasks = await read("apps/ios/CovenCave/CovenCave/Views/TasksView.swift");
const zoom = await read("apps/ios/CovenCave/CovenCave/Views/ContentZoom.swift");

// Supplied device reference: this is the canonical first empty conversation.
assert.match(chat, /Text\("Start a new session"\)/, "empty chat keeps the authored serif heading");
assert.match(
  chat,
  /Speak your intent — a familiar answers from the desktop\./,
  "empty chat explains the desktop-backed familiar",
);
assert.match(
  chat,
  /Nothing is written to your repos until you lift the/,
  "empty chat preserves the ward safety boundary",
);
assert.match(chat, /"Review my open PRs"/, "first quick action follows the supplied start page");
assert.match(chat, /"What's on the board\?"/, "second quick action follows the supplied start page");
assert.match(chat, /"Chase the [^"]+"/, "third quick action is grounded in a real priority task");
assert.match(chat, /icon: "arrow\.triangle\.branch"/, "the PR starter uses a valid native branch glyph");
assert.match(
  chat,
  /private var emptyState:[\s\S]*?VStack\(spacing: 18\)/,
  "the empty-session composition stays together as one centered stack",
);
assert.match(chat, /Image\(systemName: "arrow\.up"\)/, "the canonical composer keeps its send arrow visible");
assert.match(chat, /\.disabled\(!canSend\)/, "the empty send arrow is present but inert");
assert.match(
  chrome,
  /\.fixedSize\(horizontal: false, vertical: true\)/,
  "starter-card copy grows vertically instead of overlapping at larger type",
);
assert.match(
  chrome,
  /RoundedRectangle\(cornerRadius: 9/,
  "starter icons use the authored rounded-square well",
);
assert.match(
  appModel,
  /--ui-preview-empty-chat/,
  "the canonical empty-session surface has a deterministic simulator preview",
);

// Authored navigation and discovery surfaces.
assert.match(
  home,
  /List\(selection: \$selection\) \{\s*Section \{\s*familiarRail/s,
  "Chats renders the familiar rail it defines",
);
assert.match(root, /CaveNavigationDrawer\(/, "the global Claude Design drawer is mounted at app root");
assert.match(root, /case \.projects: ProjectsPanel/, "Projects is a real drawer destination");
assert.match(root, /case \.familiars: FamiliarsListView/, "Familiars is a real drawer destination");
assert.match(familiars, /struct FamiliarDetailView: View/, "familiar rows open a real detail surface");
assert.match(
  familiars,
  /familiar\.activeSessions\.map\(String\.init\) \?\? "Unknown"/,
  "missing live activity is labelled unknown rather than fabricated as zero",
);
for (const section of ["Identity", "Defaults", "Access"]) {
  assert.match(familiars, new RegExp(`Text\\("${section}"\\)`), `familiar detail includes ${section}`);
}

// Session controls are transported, persisted for offline replay, and truthful.
assert.match(client, /var reasoningEffort: ChatThinkingEffort/, "send body carries reasoning effort");
assert.match(client, /var responseSpeed: ChatResponseSpeed/, "send body carries response speed");
assert.match(thread, /var reasoningEffort: ChatThinkingEffort\?/, "queued messages persist reasoning effort");
assert.match(thread, /var responseSpeed: ChatResponseSpeed\?/, "queued messages persist response speed");
assert.match(chat, /Picker\("Thinking"/, "session details expose real thinking levels");
assert.match(chat, /Picker\("Speed"/, "session details expose real response speeds");
assert.doesNotMatch(chat, /TODO\(no backend\)/, "session details no longer present known-fake controls");
assert.match(chat, /linkedContextStrip/, "real linked task context is visible in the conversation");

// Marketplace state comes from the desktop rather than a session-local catalog.
assert.match(client, /func marketplacePlugins\(\)/, "iOS can read the live marketplace");
assert.match(client, /func installMarketplacePlugin\(/, "iOS can install a live marketplace plugin");
assert.match(client, /func uninstallMarketplacePlugin\(/, "iOS can uninstall a live marketplace plugin");
assert.match(plugins, /\.task \{ await loadPlugins\(\) \}/, "plugin panel loads server state");
assert.doesNotMatch(plugins, /static let featured/, "plugin panel has no fabricated featured catalog");
assert.match(
  plugins,
  /Manage this Craft from Cave on your desktop\./,
  "Craft installation is explicitly handed back to the desktop",
);

// Remaining handoff affordances.
assert.match(
  tasks,
  /@AppStorage\("cave\.tasks\.groupBy"\) private var groupByRaw = GroupBy\.familiar\.rawValue/,
  "fresh installs default Tasks to the authored familiar grouping",
);
assert.match(zoom, /Rotate for width/, "full-screen rich content explains the landscape affordance");

console.log("ios-claude-design-fidelity.test.mjs: ok");
