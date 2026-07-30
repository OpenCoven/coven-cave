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
const drawer = await read("apps/ios/CovenCave/CovenCave/Views/NavigationDrawer.swift");
const projects = await read("apps/ios/CovenCave/CovenCave/Views/ProjectsPanel.swift");
const familiars = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarsListView.swift");
const plugins = await read("apps/ios/CovenCave/CovenCave/Views/PluginsPanel.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const thread = await read("apps/ios/CovenCave/CovenCave/State/ChatThread.swift");
const modelControl = await read("apps/ios/CovenCave/CovenCave/Views/ChatModelControl.swift");
const caveClient = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const appModel = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const caveApp = await read("apps/ios/CovenCave/CovenCave/CovenCaveApp.swift");
const tasks = await read("apps/ios/CovenCave/CovenCave/Views/TasksView.swift");
const linkedTasks = await read("apps/ios/CovenCave/CovenCave/Views/LinkedTasksSheet.swift");
const terminal = await read("apps/ios/CovenCave/CovenCave/Views/TerminalView.swift");
const settings = await read("apps/ios/CovenCave/CovenCave/Views/SettingsView.swift");
const glass = await read("apps/ios/CovenCave/CovenCave/Theme/Glass.swift");
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
  /Repo access follows \\\(wardScope\) active/,
  "empty chat describes the real ward boundary without promising an unavailable mode",
);
assert.match(chat, /permissionsFamiliar = familiar/, "the ward copy opens the real permission controls");
assert.match(chat, /\.sheet\(item: \$permissionsFamiliar\)/, "ward permissions have a presentation path");
assert.match(
  chat,
  /FamiliarPickerSheet\([\s\S]{0,180}familiarIds: thread\.familiarIds/,
  "a group ward asks which member’s permissions to inspect",
);
assert.match(chat, /"each familiar’s"/, "group ward copy describes every member’s access boundary");
assert.match(chat, /\.disabled\(!canInspectWard\)/, "the group ward picker remains interactive");
assert.match(chat, /"Review my open PRs"/, "first quick action follows the supplied start page");
assert.match(
  chat,
  /Set\(app\.tasks\.flatMap\(\\\.githubLinks\)[\s\S]*?\$0\.state\?\.lowercased\(\) == "open"[\s\S]*?map \{ \$0\.url\.lowercased\(\) \}\)/,
  "the open-PR starter count is deduplicated and excludes closed or unknown links",
);
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
  chrome,
  /struct CircularIconButton:[\s\S]*?\.frame\(minWidth: 44, minHeight: 44\)/,
  "shared icon buttons keep a 44-point minimum hit target",
);
assert.match(
  appModel,
  /--ui-preview-empty-chat/,
  "the canonical empty-session surface has a deterministic simulator preview",
);
assert.match(appModel, /var launchThreadId: String\?/, "the launch thread intent belongs to AppModel");
assert.match(
  appModel,
  /func consumeLaunchThreadIntent\(\) -> ChatThread\?/,
  "the launch thread intent waits for a matching thread before consuming",
);
assert.match(
  appModel,
  /var mostRecentThread: ChatThread\? \{[\s\S]{0,180}filter \{ !\$0\.archived \}[\s\S]{0,180}max \{ \$0\.updatedAt < \$1\.updatedAt \}/,
  "the default chat is the newest active thread, independent of pin order",
);
assert.match(
  appModel,
  /if let threadId = ChatNotifications\.threadId\(fromDeepLink: url\) \{[\s\S]{0,140}launchThreadId = threadId[\s\S]{0,140}selectedTab = \.chats/,
  "runtime chat links retain their thread id until hydration",
);
assert.match(
  appModel,
  /private func loadHistory[\s\S]{0,500}DisplayMessage\.restored\(from: turn, familiarId: assignee\)/,
  "initial server-history hydration restores retry controls",
);
assert.doesNotMatch(
  home,
  /ProcessInfo\.processInfo\.environment\["CAVE_OPEN_THREAD"\]/,
  "Chats does not reread the process launch intent on every mount",
);
assert.match(
  home,
  /\.onAppear \{\s*consumeLaunchThreadIntent\(\)\s*consumeGlobalRequests\(\)\s*selectMostRecentThreadIfNeeded\(\)\s*\}/,
  "Chats selects the most recent thread after honoring explicit launch requests",
);
assert.match(
  home,
  /onChange\(of: app\.threads\.map\(\\\.id\)\)[\s\S]{0,160}consumeLaunchThreadIntent\(\)[\s\S]{0,160}selectMostRecentThreadIfNeeded\(\)/,
  "Chats retries explicit and default selection when hydration adds threads",
);
assert.match(
  home,
  /private func selectMostRecentThreadIfNeeded\(\) \{[\s\S]{0,500}guard selection == nil,[\s\S]{0,500}!showNewChat,[\s\S]{0,500}app\.threadToOpen == nil,[\s\S]{0,500}app\.launchThreadId == nil,[\s\S]{0,500}!app\.newChatRequested,[\s\S]{0,500}let thread = app\.mostRecentThread[\s\S]{0,180}open\(\.thread\(thread\)\)/,
  "the default never overrides an explicit destination or New Chat intent",
);

// Authored navigation and discovery surfaces.
assert.match(
  home,
  /List\(selection: \$selection\) \{\s*Section \{\s*familiarRail/s,
  "Chats renders the familiar rail it defines",
);
assert.match(root, /CaveNavigationDrawer\(/, "the global Claude Design drawer is mounted at app root");
assert.doesNotMatch(root, /TabView/, "the primary shell does not retain a native tab view");
assert.doesNotMatch(root, /Tab\("/, "the primary shell does not declare native tabs");
assert.doesNotMatch(root, /MainTabView/, "RootView mounts the semantically neutral shell");
assert.match(root, /struct MainShellView/, "the connected root uses MainShellView");
assert.match(
  root,
  /switch app\.selectedTab\s*\{\s*case \.chats:\s*ChatsHomeView\(\)\s*case \.tasks:\s*TasksView\(\)\s*case \.terminal:\s*TerminalView\(terminal: terminal, cwd: \$terminalCwd\)\s*case \.settings:\s*SettingsView\(\)\s*\}/s,
  "the shell mounts exactly the selected primary destination",
);
for (const label of ["Chats", "Tasks", "Terminal", "Settings"]) {
  const matches = drawer.match(new RegExp(`DrawerNavRow\\([\\s\\S]*?label: "${label}"`, "g")) ?? [];
  assert.equal(matches.length, 1, `drawer includes ${label} exactly once as a primary row`);
}
for (const [name, source] of [["Chats", home], ["Tasks", tasks], ["Terminal", terminal], ["Settings", settings]]) {
  assert.match(source, /navigationDrawerOpen = true/, `${name} exposes Open navigation`);
}
assert.doesNotMatch(chat, /\.toolbar\(\.hidden, for: \.tabBar\)/, "ChatView does not depend on a removed tab bar");
assert.doesNotMatch(glass, /UITabBar(?:Appearance)?|tabAppearance|liveTabBars/,
  "the chrome system no longer styles an unavailable native tab bar");
assert.match(glass, /UINavigationBarAppearance\.glass/,
  "the chrome system still styles live navigation bars");

// Quiet Portal keeps the cold connection state honest, themed, deterministic,
// and accessible without inventing stages the runtime cannot prove.
assert.match(root, /Text\("Entering the Cave"\)/, "connecting state uses the approved headline");
assert.match(root, /Text\("Connecting to your desktop"\)/, "connecting state names the live operation");
assert.match(root, /if let host = app\.connection\?\.host/, "connecting state renders the real saved host");
assert.match(
  root,
  /Text\(host\)[\s\S]*?\.font\(\.caption\.monospaced\(\)\)[\s\S]*?\.foregroundStyle\(chrome\.textSecondary\)[\s\S]*?\.truncationMode\(\.middle\)/,
  "connecting host uses readable secondary text, monospaced type, and middle truncation",
);
assert.match(root, /PhaseAnimator\(\[0, 1, 2\]\)/, "connecting state has indeterminate signal motion");
assert.match(root, /if reduceMotion[\s\S]*?staticSignal/, "connecting motion has a static fallback");
assert.match(
  root,
  /\.accessibilityElement\(children: \.ignore\)[\s\S]*?\.accessibilityLabel\("Connecting to your desktop"\)[\s\S]*?\.accessibilityValue\(app\.connection\?\.host \?\? ""\)/,
  "connecting state exposes one honest accessibility status",
);
assert.match(
  appModel,
  /--ui-preview-connecting[\s\S]*?CaveConnection\(host: "cave-desktop\.example"\)[\s\S]*?connectionState = \.checking[\s\S]*?isConnectingPreview = true/,
  "connecting state has a deterministic saved-host preview fixture",
);
assert.match(
  caveApp,
  /init\(\) \{[\s\S]*?notificationDelegate\.onOpen[\s\S]*?UNUserNotificationCenter\.current\(\)\.delegate = notificationDelegate[\s\S]*?_notificationDelegate = State\(initialValue: notificationDelegate\)/,
  "the notification delegate is registered synchronously for cold-launch taps",
);
assert.match(
  caveApp,
  /guard !app\.isConnectingPreview else \{ return \}[\s\S]*?app\.startConnectionSupervisor\(\)[\s\S]*?await app\.connectWithRetry\(\)/,
  "connecting preview skips only live connection work",
);
assert.match(
  drawer,
  /Color\.black\.opacity\(isOpen \? 0\.46 : 0\)/,
  "the closed drawer does not leave its dimming scrim over the app",
);
assert.match(root, /case \.projects:\s*ProjectsPanel/, "Projects is a real drawer destination");
assert.match(root, /case \.familiars: FamiliarsListView/, "Familiars is a real drawer destination");
assert.match(drawer, /openProjects\(project\)/, "drawer project shortcuts preserve the selected project");
assert.match(projects, /NavigationLink\(value: project\)/, "project rows navigate instead of rendering inertly");
assert.match(
  projects,
  /initialProject\.map \{ \[\$0\] \} \?\? \[\]/,
  "a drawer project shortcut opens that project directly",
);
assert.match(familiars, /struct FamiliarDetailView: View/, "familiar rows open a real detail surface");
assert.match(
  home,
  /FamiliarsListView \{ familiar in[\s\S]*initialNewChatFamiliarIds = \[familiar\.id\][\s\S]*showNewChat = true/,
  "the familiar detail chat action opens project-aware New Chat",
);
assert.match(
  familiars,
  /ModelPickerSheet\([\s\S]{0,400}application: \.familiarDefault/,
  "the familiar default picker labels its real scope",
);
assert.match(
  modelControl,
  /allowsRuntimeDefault:[\s\S]*?Button \{[\s\S]*?onSelect\(nil\)[\s\S]*?Text\("Runtime default"\)/,
  "runtime-owned inventories offer an actionable Runtime default choice",
);
assert.match(
  caveClient,
  /func setChatModel\([\s\S]{0,180}?model: String\?[\s\S]*?encodeNil\(forKey: \.model\)/,
  "clearing an iOS model sends JSON null instead of omitting the model field",
);
assert.match(
  modelControl,
  /Sets this familiar’s default for new chats and chats without a model override\./,
  "the model picker explains a familiar-default mutation",
);
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
assert.match(client, /var modelOverride: String\?/, "send body carries the selected model");
assert.match(
  client,
  /var modelOverrideScope: ChatModelOverrideScope\?/,
  "send body scopes the selected model to the chat",
);
assert.match(thread, /var reasoningEffort: ChatThinkingEffort\?/, "queued messages persist reasoning effort");
assert.match(thread, /var responseSpeed: ChatResponseSpeed\?/, "queued messages persist response speed");
assert.match(thread, /var modelOverride: String\?/, "queued messages persist the selected model");
assert.match(
  thread,
  /var pendingModelOverride: String\?/,
  "an unsent chat owns and persists its pending model selection",
);
assert.match(
  thread,
  /modelOverride: queuedMessage\.modelOverride/,
  "offline replay restores the queued model selection",
);
assert.match(
  thread,
  /let retryModel = source\?\.retryModel\(for: familiarId\)[\s\S]{0,900}modelOverride: retryModel/,
  "retry restores the original per-familiar model selection",
);
assert.match(
  thread,
  /modelOverrideScope: retryModel == nil \? nil : \.nextMessage/,
  "retry replays the original model without changing the chat’s current model",
);
assert.match(
  thread,
  /DisplayMessage\.restored\(from: turn, familiarId: familiarId\)/,
  "server reload restores the controls that retry reads",
);
assert.match(
  appModel,
  /DisplayMessage\.duplicate\(of: message\)/,
  "thread duplication preserves the controls that retry reads",
);
assert.match(chat, /Picker\("Thinking"/, "session details expose real thinking levels");
assert.match(chat, /Picker\("Speed"/, "session details expose real response speeds");
assert.match(
  chat,
  /let stagedModel = model \?\? ""[\s\S]{0,220}?thread\.pendingModelOverride = stagedModel/,
  "a selected model or runtime-default clear is synchronously retained as the chat's pending intent",
);
assert.match(
  chat,
  /_ = selectModel\(id, familiarId: familiarId, sessionId: modelSessionId\(familiarId\)\)/,
  "the model picker stages intent synchronously before its sheet dismisses",
);
assert.match(
  chat,
  /private var turnModelBinding: ChatModelTurnBinding/,
  "all send paths derive a turn-owned model binding",
);
assert.doesNotMatch(
  chat,
  /modelOverride: thread\.pendingModelOverride/,
  "send paths do not drop an already-confirmed session model",
);
assert.match(
  chat,
  /ChatModelTurnBinding\.shouldClearPending\(/,
  "a session id alone cannot clear unconfirmed model intent",
);
assert.match(
  chat,
  /destination\.pendingModelOverride[\s\S]{0,650}modelOverrideScope: destinationScope/,
  "forwarding honors a pending model choice on the destination chat",
);
assert.doesNotMatch(
  chat,
  /scope = sessionId != nil \? "session" : "familiar-default"/,
  "a new-chat model choice never mutates the familiar default",
);
assert.doesNotMatch(chat, /TODO\(no backend\)/, "session details no longer present known-fake controls");
assert.match(chat, /linkedContextStrip/, "real linked task context is visible in the conversation");
assert.match(
  chat,
  /FloatingAction\(id: "tasks", systemImage: "checklist", label: "Link a task"\) \{ showTasks = true \}/,
  "an unlinked conversation can link its first task",
);
assert.match(
  chat,
  /case \.checking: return \(Color\.orange, "reconnecting"\)/,
  "the chat header reports reconnecting state instead of claiming readiness",
);
assert.match(
  chat,
  /app\.tasksError != nil\s*\?\s*"Board unavailable"/,
  "the start page does not report zero board work after a failed first load",
);
assert.match(
  home,
  /if app\.familiars\.isEmpty && app\.threads\.isEmpty \{[\s\S]{0,180}if let error = app\.familiarsError \?\? app\.sessionsError \{[\s\S]{0,100}loadFailure\(error\)/,
  "Chats renders first-load failure before the no-familiars empty state",
);
assert.match(
  home,
  /private func loadFailure[\s\S]{0,500}Label\("Couldn’t load chats"[\s\S]{0,350}Button\("Retry"\)/,
  "Chats exposes a concrete recovery action after first-load failure",
);
assert.match(
  linkedTasks,
  /if !app\.tasksLoaded[\s\S]{0,260}else if let error = app\.tasksError, assignable\.isEmpty[\s\S]{0,700}Button\("Retry"\)/,
  "task linking renders refresh failure and recovery before an empty result",
);
assert.match(
  projects,
  /if let error = app\.projectsError, app\.projects\.isEmpty/,
  "the projects surface renders first-load failure before empty state",
);
assert.match(
  projects,
  /if let error = app\.tasksError[\s\S]{0,180}ContentUnavailableView/,
  "project task detail renders board failure before no-tasks state",
);
assert.match(
  familiars,
  /if let error = app\.familiarsError, app\.familiars\.isEmpty/,
  "the familiar roster renders first-load failure before empty state",
);
assert.match(
  familiars,
  /app\.tasksError == nil\s*\?\s*"\\\(assignedTasks\.count\)"\s*:\s*app\.tasks\.isEmpty \? "Unknown" : "\\\(assignedTasks\.count\) cached"/,
  "familiar task stats distinguish live, unavailable, and cached counts",
);
for (const [name, source] of [["projects", projects], ["familiars", familiars]]) {
  assert.match(
    source,
    /Button\("Retry"[\s\S]{0,180}\.frame\(minWidth: 44, minHeight: 44\)/,
    `${name} cached-state retry keeps a 44-point touch target`,
  );
}

// Marketplace state comes from the desktop rather than a session-local catalog.
assert.match(client, /func marketplacePlugins\(\)/, "iOS can read the live marketplace");
assert.match(client, /func installMarketplacePlugin\(/, "iOS can install a live marketplace plugin");
assert.match(client, /func uninstallMarketplacePlugin\(/, "iOS can uninstall a live marketplace plugin");
assert.match(plugins, /\.task \{ await loadPlugins\(\) \}/, "plugin panel loads server state");
assert.match(
  plugins,
  /let catalogOutcome = await loadPlugins\(\)[\s\S]{0,500}disposition\(/,
  "plugin writes reconcile the authoritative catalog even after transport ambiguity",
);
assert.doesNotMatch(plugins, /static let featured/, "plugin panel has no fabricated featured catalog");
const marketplaceRows = plugins.slice(
  plugins.indexOf("ForEach(filtered)"),
  plugins.indexOf("\n    @ViewBuilder", plugins.indexOf("ForEach(filtered)")),
);
assert.ok(
  marketplaceRows.indexOf(".buttonStyle(.plain)") < marketplaceRows.indexOf("installButton(plugin)"),
  "marketplace details and install are sibling controls rather than nested buttons",
);
assert.match(
  plugins,
  /Manage this Craft from Cave on your desktop\./,
  "Craft installation is explicitly handed back to the desktop",
);
assert.match(
  plugins,
  /plugin\.kind == "craft" \|\| plugin\.kind == "knowledge-pack"/,
  "knowledge packs are not sent through the generic plugin install endpoint",
);
assert.match(
  plugins,
  /Manage this Knowledge pack from Cave on your desktop\./,
  "knowledge-pack seeding is explicitly handed back to the desktop",
);
assert.match(
  plugins,
  /let catalogOutcome = await loadPlugins\(\)[\s\S]*?MarketplacePluginMutationReconciliation\.disposition\([\s\S]*?installed: currentPlugin\(id\)\?\.installed,[\s\S]*?expectedInstalled: !wasInstalled/,
  "a mutation only claims success after install state reconciles",
);
assert.match(
  plugins,
  /if let selected \{\s*self\.selected = currentPlugin\(selected\.id\)\s*\}/,
  "plugin detail state re-resolves from each authoritative catalog",
);
assert.match(
  plugins,
  /guard generation == loadGeneration else \{ return \.superseded \}/,
  "only the newest catalog request may reconcile plugin state",
);
assert.match(
  plugins,
  /private func installButton[\s\S]*?\.frame\(minWidth: 44, minHeight: 44\)/,
  "marketplace install controls keep a 44-point minimum hit target",
);
assert.match(
  plugins,
  /let tryInChat: \(MarketplacePlugin\) -> Void/,
  "the marketplace chat handoff carries the selected plugin",
);
assert.match(
  plugins,
  /private var canTryInChat: Bool[\s\S]*?plugin\.installed[\s\S]*?plugin\.configured/,
  "Try in chat is only available for a usable plugin",
);
assert.match(
  plugins,
  /Button\(action: \{ tryInChat\(plugin\) \}\)[\s\S]*?\.disabled\(!canTryInChat\)/,
  "the detail action hands the usable plugin to chat",
);
assert.match(
  chat,
  /PluginsPanel \{ plugin in\s*prefillPlugin\(plugin\)\s*\}/,
  "the marketplace handoff delegates the selected plugin to the draft-preserving prefill helper",
);
assert.match(
  chat,
  /private func prefillPlugin\(_ plugin: MarketplacePlugin\) \{[\s\S]*?let prompt = "Use \\\(plugin\.displayName\) to "/,
  "the marketplace handoff builds the exact plugin prompt in a private helper",
);
assert.match(
  chat,
  /draft = draft\.isEmpty \? prompt : "\\\(draft\)\\n\\\(prompt\)"/,
  "plugin prefill replaces only a blank draft and otherwise preserves it before a newline prompt",
);
const composerBar = chat.slice(
  chat.indexOf("private var composerBar"),
  chat.indexOf("\n    private var composerBorderColor"),
);
assert.ok(
  (composerBar.match(/\.frame\(minWidth: 44, minHeight: 44\)/g) ?? []).length >= 3,
  "composer attach, stop, and send controls keep 44-point minimum hit targets",
);

// Remaining handoff affordances.
assert.match(
  tasks,
  /@AppStorage\("cave\.tasks\.groupBy"\) private var groupByRaw = GroupBy\.familiar\.rawValue/,
  "fresh installs default Tasks to the authored familiar grouping",
);
assert.match(zoom, /Rotate for width/, "full-screen rich content explains the landscape affordance");

console.log("ios-claude-design-fidelity.test.mjs: ok");
