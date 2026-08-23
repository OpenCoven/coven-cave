import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const [
  models,
  devModels,
  client,
  connection,
  thread,
  appModel,
  devClient,
  newChat,
  chat,
  picker,
  home,
  familiarThreads,
  root,
  nativeContractTests,
  nativeSelectionTests,
  nativeClientTests,
  nativeAppContextTests,
  nativeContextTests,
  voiceClientTests,
  voiceModelTests,
  uiTests,
  snapshotTests,
  runner,
] = await Promise.all([
  read(`${iosRoot}/Models/Models.swift`),
  read(`${iosRoot}/Models/DevModels.swift`),
  read(`${iosRoot}/Networking/CaveClient.swift`),
  read(`${iosRoot}/Networking/CaveConnection.swift`),
  read(`${iosRoot}/State/ChatThread.swift`),
  read(`${iosRoot}/State/AppModel.swift`),
  read(`${iosRoot}/Networking/CaveClient+Dev.swift`),
  read(`${iosRoot}/Views/NewChatView.swift`),
  read(`${iosRoot}/Views/ChatView.swift`),
  read(`${iosRoot}/Views/ChatProjectPicker.swift`),
  read(`${iosRoot}/Views/ChatsHomeView.swift`),
  read(`${iosRoot}/Views/FamiliarThreadsView.swift`),
  read(`${iosRoot}/Views/RootView.swift`),
  read("apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/ChatProjectSelectionTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/ChatProjectClientTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/AppModelProjectContextTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/ChatNewConversationContextTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/VoiceSessionContractTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/LiveVoiceCallModelTests.swift"),
  read("apps/ios/CovenCave/CovenCaveUITests/NewChatUITests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/ThreadSnapshotStoreTests.swift"),
  read("scripts/run-tests.mjs"),
]);

const [voiceState, voiceModel, voiceTurnSender, appleVoiceTransport] = await Promise.all([
  read(`${iosRoot}/Voice/LiveVoiceCallState.swift`),
  read(`${iosRoot}/Views/Voice/LiveVoiceCallModel.swift`),
  read(`${iosRoot}/Views/Voice/CaveVoiceTurnSender.swift`),
  read(`${iosRoot}/Voice/AppleVoiceTransport.swift`),
]);

// Wire and persistence: a new local thread owns project provenance and every
// first-turn transport carries it until the server returns a session.
assert.match(
  models,
  /var projectRoot: String\? = nil[\s\S]*case projectRoot = "project_root"/,
  "server sessions must decode their authoritative project_root",
);
assert.match(
  client,
  /struct SendBody: Encodable[\s\S]*var sessionId: String\?[\s\S]*var projectRoot: String\?/,
  "iOS chat requests must encode projectRoot alongside an optional sessionId",
);
assert.match(
  thread,
  /struct ThreadSnapshot[\s\S]*var projectRoot: String\? = nil[\s\S]*final class ChatThread[\s\S]*var projectRoot: String\?/,
  "projectRoot must persist on backward-compatible thread snapshots",
);
assert.match(
  thread,
  /guard projectRoot != nil \|\| sessionID != nil else \{ return nil \}[\s\S]*projectRoot: projectRoot/,
  "the shared send-body factory must reject unresolved first turns and carry the resolved root",
);
assert.match(
  thread,
  /func send[\s\S]*guard requireSendProvenance\(to: familiarIds\) else \{ return \}[\s\S]*func enqueue[\s\S]*guard requireSendProvenance\(to: familiarIds\) else \{ return \}/,
  "online and offline sends must refuse transcript mutation without launch provenance",
);
assert.match(
  thread,
  /func applyProjectRecovery\(for error: Error\) -> Bool[\s\S]*requiresProjectSelection == true[\s\S]*projectRoot = nil[\s\S]*needsProjectSelection = true/,
  "structured project errors must reopen selection only through the thread recovery contract",
);

// Project discovery is familiar-scoped. Group chats use the intersection, not
// a union that one participant may be unable to enter.
assert.match(
  devModels,
  /struct ProjectInfo: Codable, Identifiable, Hashable, Sendable[\s\S]*var access: ProjectAccessLevel\?/,
  "project choices must retain familiar-scoped access metadata",
);
assert.match(
  picker,
  /app\.loadChatProjects\(familiarIds: familiarKey\)/,
  "the picker must request projects scoped to every selected familiar",
);
assert.match(
  devClient,
  /let \(data, response\) = try await data\(for: request\)/,
  "project discovery must use the client's injected, retrying request boundary",
);
assert.doesNotMatch(
  devClient,
  /devSharedSession/,
  "project discovery must not bypass the client request boundary with a private session",
);
assert.match(
  picker,
  /let refreshToken: Int[\s\S]*var onManageAccess: \(\(\) -> Void\)\?/,
  "the picker must require a caller-driven refresh token and keep access repair optional",
);

// Fail fast if a merge conflict marker was accidentally checked in. Match any
// of the three conflict marker kinds at the start of a line: <<<<<<<, =======, >>>>>>>
assert.doesNotMatch(
  picker,
  /^(?:<{7}|={7}|>{7})/m,
  "the picker must not contain unresolved Git conflict markers",
);

// Enforce the memberwise-declared property sequence so call sites continue to
// use the memberwise initializer in the expected order: refreshToken, the
// defaulted requiresExplicitSelection flag, then the optional callbacks.
assert.match(
  picker,
  /let refreshToken: Int[\s\S]*var requiresExplicitSelection = false[\s\S]*var onResolved: \(\(\) -> Void\)\?[\s\S]*var onManageAccess: \(\(\) -> Void\)\?/,
  "the picker must declare refreshToken, requiresExplicitSelection, onResolved, onManageAccess in that order",
);
assert.match(
  picker,
  /private struct LoadIdentity: Hashable \{[\s\S]*let key: LoadKey[\s\S]*let generation: Int[\s\S]*\}/,
  "the picker must stamp each load with a key and generation identity",
);
assert.match(
  picker,
  /private var loadKey: LoadKey \{[\s\S]*refreshToken: refreshToken/,
  "the picker must rebuild project loading from the caller-driven refresh token",
);
assert.match(
  picker,
  /resolvedLoadKey != loadKey[\s\S]*ProgressView\("Finding shared projects…"\)/,
  "the picker must hide stale projects until the current load resolves",
);
assert.match(
  picker,
  /loadGeneration &\+= 1[\s\S]*let identity = LoadIdentity\(key: loadKey, generation: loadGeneration\)/,
  "the picker must capture the load identity before any async work begins",
);
assert.match(
  picker,
  /projects = \[\][\s\S]*errorMessage = nil[\s\S]*isResolved = false/,
  "the picker must clear stale project options before a new load can show them",
);
assert.match(
  picker,
  /defer \{[\s\S]*if loadGeneration == identity\.generation \{[\s\S]*isLoading = false/,
  "only the active load may clear the loading indicator",
);
assert.match(
  picker,
  /guard loadGeneration == identity\.generation, loadKey == identity\.key else \{[\s\S]*return[\s\S]*\}/,
  "only the active load may commit loaded projects or completion state",
);
assert.match(
  picker,
  /else if projects\.isEmpty \{[\s\S]*(?:if\s+let\s+onManageAccess\s*\{\s*Button\(\s*"Project access"\s*,\s*action:\s*onManageAccess\s*\)\s*\}|guard\s+let\s+onManageAccess\s*=\s*onManageAccess\s*else\s*\{[\s\S]*?\}\s*Button\(\s*"Project access"\s*,\s*action:\s*onManageAccess\s*\))/,
  "the empty project list must guard the Project access button behind a non-nil manage-access action",
);
assert.match(
  picker,
  /else if projects\.isEmpty \{[\s\S]*Button\("Retry"\) \{ reloadToken \+= 1 \}[\s\S]*if let onManageAccess/,
  "the empty project list must support an immediate retry before optional access repair",
);
assert.match(
  picker,
  /loadProjectsWithRecovery\([\s\S]*recoverConnectionInBackground\(\)[\s\S]*connectionState == \.connected/,
  "new-chat project discovery must recover a stale connection before surfacing failure",
);
assert.match(
  nativeSelectionTests,
  /testProjectLoadRetriesOnceAfterConnectionRecovery[\s\S]*testProjectLoadPreservesOriginalErrorWhenRecoveryFails/,
  "native tests must bound new-chat project recovery to one retry",
);
assert.match(
  picker,
  /ChatProjectSelection\.resolvedRoot\([\s\S]*current: selectedRoot,[\s\S]*recent: recentRoots,[\s\S]*projects: loaded/,
  "new chats must resolve current, recent, then stable project fallback",
);
assert.match(
  picker,
  /requiresExplicitSelection[\s\S]*\\? nil[\s\S]*ChatProjectSelection\.resolvedRoot/,
  "a rejected project must require an explicit replacement instead of silently retrying",
);
assert.doesNotMatch(
  picker,
  /\blocked\b|lockedProject|Start a new chat to use another project\./,
  "the project picker must not contain a read-only started-chat presentation",
);
assert.doesNotMatch(
  picker,
  /guard let client = app\.client else \{[\s\S]*?selectedRoot = nil[\s\S]*?return/,
  "a transient connection outage must not erase persisted project provenance",
);
assert.doesNotMatch(
  picker,
  /guard !familiarKey\.isEmpty \{[\s\S]*selectedRoot = nil/,
  "an empty familiar scope must not erase the selected project root",
);
assert.doesNotMatch(
  picker,
  /catch \{[\s\S]*?projects = \[\][\s\S]*?selectedRoot = nil[\s\S]*?errorMessage = error\.localizedDescription/,
  "a project-list failure must not erase the last persisted project root",
);

// All user-visible constructors route through selection and preserve the root.
assert.match(
  newChat,
  /private var activeProject: ProjectInfo\? \{ app\.activeProject \}/,
  "New Chat must derive its root from the active project context",
);
assert.match(
  newChat,
  /private var canLaunchChat: Bool \{[\s\S]*activeProjectRoot != nil[\s\S]*!selectedFamiliarIds\.isEmpty[\s\S]*unavailableSelectedFamiliarIDs\.isEmpty[\s\S]*\}/,
  "launch gating must require the active project root and only active-project familiars",
);
assert.match(
  newChat,
  /Label\("Import from Markdown…", systemImage: "square\.and\.arrow\.down"\)[\s\S]*\.disabled\(!canLaunchChat\)[\s\S]*Button\(isGroup \? "Create" : "Start"\)\s*\{[\s\S]*\.disabled\(!canLaunchChat\)/,
  "Import and Start controls must stay disabled until launch is allowed",
);
assert.match(
  newChat,
  /Section\("Project"\) \{[\s\S]*Label\(activeProject\.name, systemImage: "folder"\)[\s\S]*Switch projects from Chats to use another root\./,
  "New Chat must describe the fixed active project instead of offering a picker",
);
assert.match(
  newChat,
  /let fixedFamiliarId: String\?[\s\S]*if fixedFamiliarId == nil[\s\S]*Section\(selected\.isEmpty \? "Choose familiars" :/,
  "fixed familiar mode must hide the editable familiar roster",
);
assert.match(
  newChat,
  /private var blockedMessage: \(title: String, body: String, systemImage: String\)\? \{[\s\S]*Unassigned chats are recovery-only\./,
  "Unassigned New Chat must surface recovery-only guidance",
);
assert.match(
  newChat,
  /private var blockedMessage: \(title: String, body: String, systemImage: String\)\? \{[\s\S]*This familiar is no longer in/,
  "fixed familiar launches must explain when the selected familiar leaves the active project",
);
assert.match(
  newChat,
  /private var selectedFamiliarIds: \[String\] \{[\s\S]*availableFamiliars\.map\(\\\.id\)\.filter \{ selected\.contains\(\$0\) \}[\s\S]*\}/,
  "selectedFamiliarIds must stay inside the active project roster",
);
assert.match(
  newChat,
  /init\([\s\S]*initialFamiliarIds:\s*\[String\]\s*=\s*\[\][\s\S]*fixedFamiliarId:\s*String\?\s*=\s*nil[\s\S]*(?:let\s+\w+\s*=\s*fixedFamiliarId\.map\s*\{\s*\[\$0\]\s*\}\s*\?\?\s*initialFamiliarIds[\s\S]*_selected\s*=\s*State\(initialValue:\s*Set\(\s*\w+\s*\)|_selected\s*=\s*State\(initialValue:\s*Set\(fixedFamiliarId\.map\s*\{\s*\[\$0\]\s*\}\s*\?\?\s*initialFamiliarIds\)\))/,
  "fixed familiar launches must seed the selected roster from the fixed familiar when present",
);
assert.match(
  newChat,
  /startFreshThread\([\s\S]*projectRoot: activeProjectRoot[\s\S]*createGroup\([\s\S]*projectRoot: activeProjectRoot/,
  "direct and group constructors must always persist the active project root",
);
assert.match(
  newChat,
  /let launchContext = NewChatImportLaunchContext\([\s\S]*activeProject: activeProject,[\s\S]*selectedFamiliarIds: selectedFamiliarIds[\s\S]*\)[\s\S]*importLaunchContext = launchContext[\s\S]*importingFile = true/,
  "imports must freeze the active project context before opening the picker",
);
assert.match(
  newChat,
  /switch launchContext\.validate\([\s\S]*projectContext: app\.projectContext,[\s\S]*activeProject: activeProject,[\s\S]*projectMembership: app\.projectMembership[\s\S]*\)[\s\S]*importMarkdown\([\s\S]*familiarIds: launchContext\.familiarIds,[\s\S]*projectRoot: launchContext\.projectRoot/,
  "imports must revalidate the frozen project context before opening the imported thread",
);
assert.doesNotMatch(
  newChat,
  /ChatProjectPicker\(|showProjectAccess|projectRefreshToken|FamiliarPermissionsSheet/,
  "normal New Chat must not offer an independent project picker or access sheet",
);
assert.match(
  appModel,
  /func createGroup\([\s\S]*projectRoot: String[\s\S]*ChatThread\([\s\S]*projectRoot: projectRoot/,
  "group creation must require a project root",
);
assert.match(
  appModel,
  /func importMarkdown\([\s\S]*familiarIds preferredFamiliarIds: \[String\][\s\S]*projectRoot: String[\s\S]*ChatThread\([\s\S]*familiarIds: familiarIds,[\s\S]*projectRoot: projectRoot/,
  "Markdown imports must retain selected familiars and project provenance",
);
assert.match(
  appModel,
  /ChatProjectSelection\.importedFamiliarIDs\([\s\S]*preferred: preferredFamiliarIds,[\s\S]*discovered: discoveredFamiliarIds/,
  "explicit import participants must remain the project-authorized send scope",
);
assert.match(
  appModel,
  /func startFreshThread\([\s\S]*projectRoot: String[\s\S]*ChatThread\(/,
  "fresh-thread creation must require a project root",
);
assert.match(
  appModel,
  /func startFreshThreadInActiveProject\([\s\S]*guard let activeProject, let activeProjectRoot else \{ return nil \}[\s\S]*guard projectMembershipLoaded else \{[\s\S]*Refresh Chats to load project access[\s\S]*\}[\s\S]*let invalidFamiliarIDs = familiarIds\.filter \{[\s\S]*projectMembership\.contains\(\$0, in: activeProject\)[\s\S]*Open New Chat to choose a valid roster or switch projects/,
  "/new and replacement flows must validate every participant against the active project roster",
);
assert.match(
  appModel,
  /private func taskChatLaunchProject\([\s\S]*Unassigned tasks are recovery-only\.[\s\S]*This task is no longer linked to a registered project\.[\s\S]*can’t access[\s\S]*return project/,
  "task chat launches must block recovery-only, deleted-project, and access-denied launches with guidance",
);
assert.match(
  appModel,
  /private enum TaskLinkedSessionResolution \{[\s\S]*case resolved\(SessionRow\)[\s\S]*case confirmedMissing\(ConfirmedMissingReason\)[\s\S]*case transientLoadFailure/,
  "task linked-session resolution must distinguish resolved rows, confirmed missing metadata, and transient load failures",
);
assert.match(
  appModel,
  /func openChat\(for card: BoardCard, familiarId: String\? = nil\) async -> ChatThread\? \{[\s\S]*if let sessionID = normalizedSessionID\(card\.sessionId\) \{[\s\S]*let resolution = await resolveTaskLinkedSession\(sessionID: sessionID\)[\s\S]*switch resolution \{[\s\S]*case \.resolved\(let authoritativeRow\):[\s\S]*taskLinkedThread\(\s*titled: title,\s*for: card,\s*authoritativeRow: authoritativeRow,\s*fallbackFamiliarID: requestedFamiliarID\s*\)[\s\S]*taskChatSessionPreview\([\s\S]*case \.confirmedMissing:[\s\S]*taskRecoveryThread\(for: card, sessionID: sessionID\)[\s\S]*case \.transientLoadFailure:[\s\S]*return nil[\s\S]*guard let taskProject = taskChatLaunchProject\(\s*for: card,\s*familiarId: requestedFamiliarID\s*\)[\s\S]*projectRoot: taskProject\.root/,
  "task chat launches must resolve authoritative session roots first, downgrade only confirmed-missing links to recovery, and create a fresh task-project chat only when no server session is linked",
);
assert.match(
  appModel,
  /func openChat\(for card: BoardCard, familiarId: String\? = nil\) async -> ChatThread\? \{[\s\S]*case \.confirmedMissing:[\s\S]*showToast\([\s\S]*taskRecoveryThread\(for: card, sessionID: sessionID\)[\s\S]*case \.transientLoadFailure:[\s\S]*showToast\([\s\S]*return nil/,
  "task chat launches must warn for both confirmed-missing and transient linked-session failures, but only confirmed-missing outcomes may enter recovery",
);
assert.match(
  appModel,
  /private func taskRecoveryThread\(\s*for card: BoardCard,\s*sessionID: String\s*\) -> ChatThread\? \{[\s\S]*localLinkedThread\(for: card\.id\)[\s\S]*thread\(matchingSessionID: sessionID\)[\s\S]*thread\.projectRoot = nil[\s\S]*persistThreads\(\)[\s\S]*return thread/,
  "confirmed-missing task-session recovery must reuse an existing local thread, strip project provenance, and avoid inserting or relabeling a fresh chat",
);
assert.match(
  appModel,
  /private func taskLinkedThread\([\s\S]*let changed = backfillThreadProjectRoots\(from: \[row\]\)[\s\S]*guard let sessionID = normalizedSessionID\(row\.id\) else \{ return nil \}[\s\S]*if let existing = linkedThread\(for: card\) \{[\s\S]*repairThreadSessionBinding\([\s\S]*if let existing = thread\(matchingSessionID: sessionID\) \{[\s\S]*guard let resolvedFamiliarID = authoritativeFamiliarID\([\s\S]*threads\.insert\(thread, at: 0\)[\s\S]*loadHistory\(into: thread, sessionId: sessionID\)/,
  "task-linked authoritative session opens must reuse and repair either a compatible local link or an already materialized server session before inserting a new one",
);
assert.match(
  appModel,
  /func linkedThread\(for card: BoardCard\) -> ChatThread\? \{[\s\S]*let authoritativeSessionID = normalizedSessionID\(card\.sessionId\)[\s\S]*let taskAuthoritativeRow = cachedSessionRow\(for: authoritativeSessionID\)[\s\S]*taskLinkMatchesProject\([\s\S]*taskAuthoritativeRow[\s\S]*thread\(matchingSessionID: sessionID\)[\s\S]*authoritativeRow: taskAuthoritativeRow/,
  "task-linked thread lookups must prefer the task’s authoritative session row and reject stale local links whose project scope no longer matches",
);
assert.match(
  appModel,
  /private func repairTaskChatScopeAfterProjectMove\(cardId: String\) async -> String\?[\s\S]*requestTaskSession\(cardId: card\.id, sessionId: nil\)[\s\S]*clearLocalTaskThreadLink/,
  "moving a task to a registered project must repair or clear incompatible task-chat links",
);
assert.match(
  appModel,
  /private func authoritativeFamiliarID\([\s\S]*row\.familiarId[\s\S]*fallbackFamiliarID/,
  "task-linked server sessions must prefer the server row's familiarId before task or caller fallback",
);
assert.match(
  appModel,
  /private func repairThreadSessionBinding\([\s\S]*thread\.sessionIds[\s\S]*thread\.familiarIds[\s\S]*persistThreads\(\)/,
  "existing server-backed task threads must repair stale familiar/session bindings before opening",
);
assert.match(
  appModel,
  /private func repairThreadSessionBinding\([\s\S]*let isDirectThread = !thread\.isGroup[\s\S]*isDirectThread: isDirectThread/,
  "task-linked repair must preserve structural group rosters instead of inferring directness from bound session count",
);
assert.doesNotMatch(
  appModel,
  /isDirectThread:\s*nextSessionIDs\.count\s*<=\s*1/,
  "task-linked repair must not collapse group rosters just because only one participant is bound",
);
assert.match(
  chat,
  /if thread\.canChangeProject && \(thread\.needsProjectSelection \|\| !thread\.canSendMessages\) \{[\s\S]*ChatProjectPicker\([\s\S]*selectedRoot: \$thread\.projectRoot[\s\S]*refreshToken:\s*0[\s\S]*requiresExplicitSelection: thread\.needsProjectSelection[\s\S]*onResolved:\s*\{\s*thread\.needsProjectSelection = false[\s\S]*app\.touch\(thread\)\s*\}/,
  "Chat must show project recovery only while the thread can still change project",
);
assert.doesNotMatch(
  chat,
  /locked: !thread\.canChangeProject/,
  "started chats must not configure a locked Project band",
);
assert.match(
  chat,
  /startFreshThreadInActiveProject\([\s\S]*familiarIds: thread\.familiarIds/,
  "/new and replacement flows must start in the active project",
);
assert.match(
  chat,
  /if isRecoveryOnlyThread \{[\s\S]*recoveryOnlyComposer[\s\S]*\} else \{[\s\S]*composer[\s\S]*\}/,
  "established projectless chats must replace the composer with recovery-only guidance",
);
assert.match(
  chat,
  /private var recoveryOnlyComposer: some View[\s\S]*Start replacement chat/,
  "recovery-only chats must offer a start-replacement affordance when a project is active",
);
assert.match(
  chat,
  /app\.markFamiliarViewed\(\s*thread\.familiarIds,\s*in:\s*app\.projectContext\(for: thread\)\s*\)/,
  "opening a chat must clear unread state in that thread's own project context",
);
assert.match(
  chat,
  /private var visibleThreadContext: ProjectContext \{[\s\S]*app\.projectContext\(for: thread\)\s*\}/,
  "chat actions must derive their routing context from the visible thread itself",
);
assert.match(
  chat,
  /private var voiceCallLaunch: VoiceCallLaunch\? \{[\s\S]*guard !isRecoveryOnlyThread else \{ return nil \}[\s\S]*guard app\.threadOpenFailure\(for: thread\) == nil else \{ return nil \}[\s\S]*guard visibleThreadContext != \.unassigned else \{ return nil \}[\s\S]*guard let projectRoot = thread\.projectRoot\?/,
  "voice calls must stay unavailable for recovery-only, invalid-metadata, and Unassigned chats until the thread has a registered project root",
);
assert.match(
  chat,
  /LiveVoiceCallView\([\s\S]*sessionId: voiceCallLaunch\.sessionId,[\s\S]*projectRoot: voiceCallLaunch\.projectRoot,[\s\S]*onSessionEstablished: \{ sessionId in[\s\S]*bindVoiceCallSession\(sessionId, for: voiceCallLaunch\.familiar\.id\)[\s\S]*onSessionDiscarded: \{ sessionId in[\s\S]*unbindVoiceCallSession\(sessionId, for: voiceCallLaunch\.familiar\.id\)[\s\S]*onCleanupWarning: \{ message in[\s\S]*app\.showToast\(message,[\s\S]*style: \.warning\)/,
  "ChatView must pass thread project provenance into live voice calls, bind new server sessions, clear discarded bindings, and surface cleanup failures through app toasts",
);
assert.match(
  chat,
  /private func bindVoiceCallSession\(_ sessionId: String, for familiarId: String\) \{[\s\S]*app\.bindThreadSession\(sessionId, to: thread, for: familiarId\)/,
  "voice-session binding should flow through AppModel so task-linked voice chats reconcile their card session ids immediately",
);
assert.match(
  chat,
  /private func unbindVoiceCallSession\(_ sessionId: String, for familiarId: String\) \{[\s\S]*thread\.sessionIds\.removeValue\(forKey: familiarId\)[\s\S]*app\.touch\(thread\)/,
  "discarded auto-created voice sessions must remove their local thread binding",
);
assert.match(
  appModel,
  /func bindThreadSession\(_ sessionId: String, to thread: ChatThread, for familiarId: String\) \{[\s\S]*let hadAnySession = primarySessionId\(of: thread\) != nil[\s\S]*thread\.sessionIds\[familiarId\] = trimmed[\s\S]*touch\(thread\)[\s\S]*if !hadAnySession, cardThreadLinks\.values\.contains\(thread\.id\) \{[\s\S]*await reconcileCardLinks\(for: thread\)/,
  "voice-first task chats must PATCH linked cards as soon as their first server session binds",
);
assert.match(
  chat,
  /private func switchTo\(_ familiar: Familiar\) \{[\s\S]*openFamiliarLandingThread\(\s*for:\s*familiar\.id,\s*in:\s*visibleThreadContext\s*\)/,
  "familiar switching must reuse or materialize the landing chat inside the visible thread context",
);
assert.match(
  chat,
  /private func forward\(_ message: DisplayMessage, to familiar: Familiar\) \{[\s\S]*let activeContext = visibleThreadContext[\s\S]*openFamiliarLandingThread\(\s*for:\s*familiar\.id,\s*in:\s*activeContext,\s*loadHistory:\s*false\s*\)/,
  "forwarding must reuse or materialize the visible-thread landing chat without racing a background history import",
);
assert.match(
  appModel,
  /@discardableResult\s*func requestOpen\(_ thread: ChatThread\) -> Bool \{[\s\S]*beginProjectNavigation\(ProjectNavigationIntent\([\s\S]*entity: \.thread\(id: thread\.id\),[\s\S]*destination: \.chats/,
  "AppModel thread opens must route through the shared project-aware navigation resolver",
);
assert.match(
  appModel,
  /private func completeProjectNavigation\([\s\S]*if let context, didSwitchProject \{[\s\S]*switchProject\(to: context\)[\s\S]*selectedTab = intent\.resolvedDestination[\s\S]*if let thread \{[\s\S]*threadToOpen = thread[\s\S]*if let card \{[\s\S]*cardToOpen = card/,
  "the shared resolver must switch project first, then select the destination, then publish thread/task opens",
);
assert.match(
  appModel,
  /func openFamiliarLandingThread\(\s*for familiarId: String,\s*in context: ProjectContext\?,\s*loadHistory\s+\w+: Bool = true\s*\) -> ChatThread\? \{[\s\S]*landingDirectThread\(for: familiarId, in: context\)[\s\S]*case \.project = context,[\s\S]*serverOnlySessions\(for: familiarId, in: context\)\.first[\s\S]*openServerSession\([\s\S]*serverOnly,[\s\S]*familiarId: familiarId,[\s\S]*loadHistory: \w+[\s\S]*\)[\s\S]*directThread\(for: familiarId, in: context\)/,
  "AppModel must share one familiar landing-chat helper that prefers local, then server-only, then fresh project-bound chats while letting immediate-send paths skip background hydration",
);
assert.match(
  appModel,
  /func globalLandingDirectThread\(for familiarId: String\) -> ChatThread\? \{[\s\S]*landingDirectThread\(for: familiarId, in: \$0\)[\s\S]*\.max/,
  "AppModel must resolve a familiar's global landing chat from the most recent eligible local landing thread across contexts",
);
assert.match(
  client,
  /func startVoiceConversation\(familiarId: String, projectRoot: String\) async throws -> String \{[\s\S]*VoiceConversationStartRequest\(familiarId: familiarId, projectRoot: projectRoot\)[\s\S]*request\("api\/chat\/conversation", method: "POST", body: payload\)/,
  "fresh voice calls that need a server session must create it through the project-scoped chat conversation route",
);
assert.match(
  client,
  /func discardVoiceConversationIfEmpty\(sessionId: String\) async throws -> Bool \{[\s\S]*let escaped = try Self\.encodedPathSegment\(sessionId\)[\s\S]*ifEmpty=1[\s\S]*retryingIdempotentMutation: true/,
  "voice orphan cleanup must use the server-side ifEmpty DELETE contract through the client's retrying idempotent mutation boundary",
);
assert.match(
  voiceModel,
  /private func startRealtime\(\) async \{[\s\S]*guard let projectRoot = state\.projectRoot else \{[\s\S]*projectRequiredCopy[\s\S]*\}[\s\S]*let sessionId = try await realtimeSessionID\(client: client, projectRoot: projectRoot\)[\s\S]*mintVoiceSession\([\s\S]*familiarId: familiar\.id,\s*sessionId: sessionId/,
  "realtime voice must keep server-side grant minting while bootstrapping fresh calls through a project-scoped session",
);
assert.match(
  voiceModel,
  /private var autoCreatedSessionId: String\?[\s\S]*private var hasCommittedConversationContent = false/,
  "the voice model must track whether it auto-created a session and whether content was ever committed",
);
assert.match(
  voiceModel,
  /private func realtimeSessionID\(client: CaveClient, projectRoot: String\) async throws -> String \{[\s\S]*autoCreatedSessionId = sessionId[\s\S]*state\.receive\(\.sessionBound\(sessionId\)\)/,
  "fresh realtime calls must remember which server session they auto-created before minting",
);
assert.match(
  voiceModel,
  /private func bindThreadSessionIfNeeded\(\) \{[\s\S]*!state\.transcript\.isEmpty[\s\S]*hasCommittedConversationContent = true[\s\S]*autoCreatedSessionId = nil[\s\S]*onSessionEstablished\?\(sessionId\)/,
  "binding the thread session must retire auto-created cleanup as soon as the call has transcript content",
);
assert.match(
  voiceModel,
  /private func resetForRestart\(mode: VoiceCallMode\) \{[\s\S]*let retryableAutoCreatedSessionId = pendingAutoCreatedSessionIdForRestart\(\)[\s\S]*autoCreatedSessionId = retryableAutoCreatedSessionId[\s\S]*launch = \.idle[\s\S]*private func pendingAutoCreatedSessionIdForRestart\(\) -> String\? \{[\s\S]*!hasCommittedConversationContent,[\s\S]*!didBindThreadSession[\s\S]*return autoCreatedSessionId/,
  "retry and fallback restarts must preserve an uncommitted auto-created session id until transcript binding or confirmed deletion retires it",
);
assert.match(
  voiceModel,
  /private func scheduleAutoCreatedSessionCleanupIfNeeded\(\) \{[\s\S]*client\.discardVoiceConversationIfEmpty\(sessionId: sessionId\)[\s\S]*guard deleted else \{ return \}[\s\S]*state\.clearSessionBinding\(matching: sessionId\)[\s\S]*onSessionDiscarded\?\(sessionId\)[\s\S]*onCleanupWarning\?\(Self\.cleanupWarningMessage\(for: error\)\)/,
  "empty auto-created voice sessions must clean themselves up through the retry-safe client helper and report any cleanup failure without replacing the primary error flow",
);
assert.match(
  voiceState,
  /case sessionBound\(String\)[\s\S]*let projectRoot: String\?[\s\S]*private\(set\) var sessionId: String\?/,
  "voice call state must retain project/session provenance so first-turn calls can bind their conversation as the session appears",
);
assert.match(
  voiceState,
  /mutating func clearSessionBinding\(matching sessionId: String\) \{[\s\S]*self\.sessionId = nil/,
  "voice call state must be able to drop a deleted auto-created session id without rebuilding the whole transcript state",
);
assert.match(
  voiceTurnSender,
  /guard resolvedSessionId != nil \|\| resolvedProjectRoot != nil else \{[\s\S]*VoiceTurnSendError\.missingLaunchContext[\s\S]*\}[\s\S]*projectRoot: resolvedProjectRoot/,
  "the native voice sender must fail closed without launch provenance and carry the thread projectRoot on every first-turn send body",
);
assert.match(
  voiceTurnSender,
  /var boundSessionId = resolvedSessionId[\s\S]*var publishedSessionId = resolvedSessionId[\s\S]*case \.session\(let sessionId\):[\s\S]*publishBoundSession\([\s\S]*case \.done\(let isError, let sessionId,[\s\S]*publishBoundSession\(/,
  "the native voice sender must publish a newly announced session id as soon as the SSE stream yields .session or .done",
);
assert.match(
  appleVoiceTransport,
  /turnSender\.sendRecognizedTurn\([\s\S]*projectRoot: self\?\.currentProjectRoot \?\? context\.projectRoot,[\s\S]*onSessionBound: \{ \[weak self\] sessionId in[\s\S]*self\?\.updateSessionBinding\(from: sessionId\)/,
  "Apple native voice must relay mid-stream session bindings into call state immediately so hangups keep the thread bound",
);
assert.match(
  voiceClientTests,
  /testDiscardVoiceConversationIfEmptyUsesDeleteIfEmptyContract[\s\S]*testDiscardVoiceConversationIfEmptyPreservesDeletedFalse/,
  "voice client tests must pin the ifEmpty discard contract",
);
assert.match(
  voiceModelTests,
  /testEndingAnAutoCreatedCallWithoutTranscriptDiscardsTheEmptySession[\s\S]*testTranscriptContentPreservesAnAutoCreatedSessionOnEnd[\s\S]*testMicrophoneDenialDiscardsAnAutoCreatedSession[\s\S]*testSetupFailureNeverDeletesAPreBoundSession[\s\S]*testCleanupFailureReportsANonfatalWarningWithoutHidingMintFailure[\s\S]*testHangupAfterMidReplySessionBindingKeepsTheThreadBoundForTheNextCall/,
  "voice model tests must cover empty-session discard, transcript preservation, permission denial cleanup, pre-bound session safety, cleanup warnings, and mid-reply binding survival",
);
assert.doesNotMatch(
  voiceTurnSender,
  /projectRoot:\s*nil/,
  "no production native-voice send body should hardcode a nil projectRoot",
);
assert.match(
  appModel,
  /@discardableResult\s*func requestOpenGlobalFamiliarLandingThread\(for familiarId: String\) -> Bool \{[\s\S]*globalLandingDirectThread\(for: familiarId\)[\s\S]*globalServerOnlySessions\(for: familiarId\)\.first[\s\S]*openServerSession\([\s\S]*projectMembership\.contains\(familiarId, in: activeProject\)[\s\S]*directThread\(for: familiarId, in: \.project\(activeProject\)\)[\s\S]*requestOpen\(/,
  "global familiar opens must prefer existing chats across contexts, then server-only sessions, and only synthesize a fresh active-project chat as a last resort",
);
assert.match(
  root,
  /case \.familiars: FamiliarsListView \{ familiar in[\s\S]*openFamiliarLandingThread\(\s*for:\s*familiar\.id,\s*in:\s*app\.projectContext\s*\)/,
  "the root familiars sheet must route familiar opens through the shared landing-chat helper",
);
assert.match(
  root,
  /openFamiliar: \{ familiar in[\s\S]*requestOpenGlobalFamiliarLandingThread\(for: familiar\.id\)/,
  "global search familiar opens must route through the global landing-chat helper",
);
assert.match(
  root,
  /openServerSession: \{ session, familiarId in[\s\S]*requestOpenServerSession\(\s*session,\s*fallbackFamiliarId: familiarId\s*\)/,
  "global search server-session opens must route through the central project-aware session helper",
);
assert.match(
  root,
  /openProject: \{ project in[\s\S]*requestOpenProjectSearchResult\(project\)/,
  "global search project opens must route through the central project-aware destination helper",
);
assert.match(
  appModel,
  /func requestOpenProjectSearchResult\([\s\S]*selectedTab\.projectSearchReturnDestination[\s\S]*func requestOpenServerSession\(/,
  "AppModel must centralize project-search destination policy and server-session opens",
);
assert.match(
  chat,
  /case \.command\(let command, let args\):[\s\S]*case \.sendAsPrompt = command\.action,[\s\S]*!thread\.canSendMessages[\s\S]*thread\.needsProjectSelection = true[\s\S]*return[\s\S]*draft = ""/,
  "prompt-like slash commands must preserve their draft until project context resolves",
);
assert.match(
  home,
  /NewChatView\([\s\S]*fixedFamiliarId: fixedNewChatFamiliarId[\s\S]*presentNewChat\(fixedFamiliarId: familiar\.id\)/,
  "home familiar shortcuts must open fixed-familiar New Chat from familiar rows",
);
assert.match(
  home,
  /enum ChatNewConversationContext[\s\S]*static func fixedFamiliarId\([\s\S]*detailPath\.last \?\? selection/,
  "Chats must resolve New Chat context from the visible detail route before the sidebar selection",
);
assert.match(
  nativeAppContextTests,
  /testRequestOpenSwitchesToThreadProjectBeforeOpening[\s\S]*testRequestOpenSwitchesToUnassignedForProjectlessThread[\s\S]*testRequestOpenCanonicalizesNestedWorktreeRootToRegisteredProject[\s\S]*testRequestOpenTreatsUnknownAndDeletedRootsAsUnassigned[\s\S]*testRequestOpenTaskSwitchesToTaskProjectBeforeOpening[\s\S]*testRequestOpenTaskSwitchesToUnassignedForProjectlessTask[\s\S]*testRequestOpenProjectSearchResultKeepsProjectScopedDestination[\s\S]*testRequestOpenProjectSearchResultFallsBackToChatsFromSettings[\s\S]*testRequestOpenServerSessionSwitchesToSessionProjectBeforeOpening[\s\S]*testRequestOpenTaskTreatsUnknownProjectAsUnassignedRecovery[\s\S]*testRequestOpenTaskFailsExplicitlyWhenProjectIDIsMalformed[\s\S]*testRequestOpenFailsExplicitlyWhenProjectMetadataIsInvalid[\s\S]*testRequestOpenDoesNotSwitchProjectWhenContextAlreadyMatches[\s\S]*testEntityMetadataWinsWhenAdvisoryProjectDisagrees[\s\S]*testProjectDeepLinkFailsExplicitlyWhenProjectIsUnknown[\s\S]*testProjectChatsDeepLinkSwitchesProjectAndPreservesDestination[\s\S]*testPendingTaskNavigationSurvivesFailedHydration/,
  "native app-context tests must cover cross-project thread/task/session opens, project-search destination policy, unassigned recovery, unknown-project recovery tasks, malformed task ids, same-context no-ops, redundant-project mismatches, and pending intents that survive failed hydration",
);
assert.match(
  home,
  /private func presentContextualNewChat\(\)[\s\S]*ChatNewConversationContext\.fixedFamiliarId\([\s\S]*selection: selection,[\s\S]*detailPath: detailPath/,
  "contextual compose must derive its fixed familiar from the visible Chats route",
);
assert.match(
  home,
  /label: "New chat"\) \{\s*presentContextualNewChat\(\)/,
  "Chats compose controls must use contextual New Chat",
);
assert.match(
  home,
  /Button\("New chat"\) \{ presentGeneralNewChat\(\) \}/,
  "the no-context empty action must preserve explicit general New Chat",
);
assert.match(
  familiarThreads,
  /NewChatView\([\s\S]*fixedFamiliarId: familiar\.id/,
  "familiar history shortcuts must enter fixed-familiar New Chat",
);

// Structured failures must survive the SSE transport boundary so the draft can
// remain intact while the project picker asks for a replacement.
assert.match(
  connection,
  /case serverResponse\(status: Int, code: String\?, message: String\?\)/,
  "CaveError must retain structured status, code, and message",
);
assert.match(
  client,
  /let data = try await Self\.readServerErrorBody\(from: bytes\)[\s\S]*throw Self\.serverResponseError\([\s\S]*statusCode: http\.statusCode,[\s\S]*data: data/,
  "non-2xx chat responses must decode their bounded JSON envelope before SSE parsing",
);

// Keep behavioral and compatibility coverage present, not just source wiring.
assert.match(
  nativeContractTests,
  /testUnresolvedSendAndEnqueueDoNotMutateTranscript[\s\S]*testProjectErrorReopensSelectionBeforeFirstSession[\s\S]*testProjectErrorCannotRelabelStartedSession/,
  "native tests must cover send refusal and recoverable/locked project errors",
);
assert.match(
  nativeSelectionTests,
  /testSharedProjectsRequireEveryParticipantScope[\s\S]*testResolvedRootUsesFirstAccessibleRecentRoot[\s\S]*testExplicitImportParticipantsCannotExpandProjectSendScope/,
  "native tests must cover group intersection, deterministic resolution, and import scope",
);
assert.match(
  nativeContextTests,
  /testSelectedDirectThreadUsesItsFamiliar[\s\S]*testVisibleGroupThreadKeepsGeneralMode[\s\S]*testMissingContextKeepsGeneralMode/,
  "native tests must cover direct, group, and absent New Chat context",
);
assert.match(
  nativeClientTests,
  /testProjectRequestUsesInjectedSessionAndRetriesTransientFailure/,
  "native tests must prove project discovery uses the retrying injected transport",
);
assert.match(
  nativeAppContextTests,
  /testOpenFamiliarLandingThreadPrefersExistingLocalThreadOverServerOnlySession[\s\S]*testOpenFamiliarLandingThreadMaterializesServerOnlyProjectSession[\s\S]*testOpenFamiliarLandingThreadMaterializesServerOnlyProjectSessionForImmediateSend[\s\S]*testOpenFamiliarLandingThreadCreatesFreshProjectThreadWhenNoHistoryExists[\s\S]*testOpenFamiliarLandingThreadBlocksFreshProjectThreadWhenFamiliarCannotAccessProject[\s\S]*testOpenFamiliarLandingThreadBlocksRecoveryOnlyUnassignedMaterialization/,
  "native AppModel tests must cover landing-thread reuse, server-only immediate-send materialization, and access or Unassigned blocks",
);
assert.match(
  nativeAppContextTests,
  /testRequestOpenGlobalFamiliarLandingThreadPrefersMostRecentLocalLandingAcrossContexts[\s\S]*testRequestOpenGlobalFamiliarLandingThreadMaterializesMostRecentServerOnlySessionAcrossContexts[\s\S]*testRequestOpenGlobalFamiliarLandingThreadCreatesFreshChatInActiveProjectWhenNoHistoryExists[\s\S]*testRequestOpenGlobalFamiliarLandingThreadShowsGuidanceWhenFamiliarBelongsToDifferentProject/,
  "native AppModel tests must cover global familiar opens for existing local chats, server-only history, fresh active-project starts, and off-project guidance",
);
assert.match(
  nativeAppContextTests,
  /testLoadSessionsBackfillsLegacyRestoredThreadAndReclassifiesUnassigned[\s\S]*testOpenChatCreatesDirectTaskThreadInTaskProject[\s\S]*testOpenChatUsesChosenFamiliarForProjectScopedTaskThread[\s\S]*testOpenChatFromTaskBlocksInUnassignedRecoveryContext[\s\S]*testOpenChatFromTaskBlocksWhenTaskProjectIsMissingOrDeleted[\s\S]*testOpenChatFromTaskBlocksWhenFamiliarCannotAccessTaskProject[\s\S]*testOpenChatForTaskSessionFetchesAuthoritativeSessionWhenCacheIsEmpty[\s\S]*testOpenChatForTaskSessionOpensAuthoritativeSessionWhenProjectDisagrees[\s\S]*testAuthoritativeTaskSessionPreviewRemainsVisibleWhenTaskProjectDisagrees[\s\S]*testOpenChatForMissingTaskSessionReturnsNilWithoutMaterializingLocalThread[\s\S]*testOpenChatForTaskSessionLoadFailureReturnsNilWithoutMaterializingLocalThread[\s\S]*testOpenChatForTaskSessionLoadFailurePreservesExistingLocalThreadWithoutDowngrading[\s\S]*testOpenChatForTaskSessionMissingProjectRootReturnsNilWithoutMaterializingLocalThread[\s\S]*testRepeatedTaskSessionRecoveryFailuresDoNotGrowThreadsOrLinks[\s\S]*testOpenChatForUnresolvedTaskSessionOpensExistingLocalThreadAsRecoveryOnly[\s\S]*testOpenChatForTaskSessionMissingProjectRootOpensExistingLocalThreadAsRecoveryOnly[\s\S]*testOpenChatForMissingTaskSessionOpensAuthoritativeSessionAfterRefresh[\s\S]*testOpenChatForMissingTaskSessionRestoresExistingRecoveryThreadAfterRefresh[\s\S]*testStartFreshThreadInActiveProjectCreatesThreadForValidRoster[\s\S]*testStartFreshThreadInActiveProjectBlocksRosterOutsideActiveProject/,
  "native AppModel tests must cover legacy backfill, blocked task launches, authoritative session recovery across mismatches, and active-project roster validation",
);
assert.match(
  nativeAppContextTests,
  /testMoveTaskToProjectClearsProjectlessLocalChatLink[\s\S]*testMoveTaskToProjectPreservesCompatibleLocalChatLink[\s\S]*testMoveTaskToProjectUnlinksMismatchedServerBackedChat[\s\S]*testMoveTaskToProjectKeepsLinkStateWhenServerUnlinkFails/,
  "native AppModel tests must cover project-repair reconciliation for local-only, preserved, mismatched, and unlink-failure task chat links",
);
assert.match(
  uiTests,
  /testContextualNewChatUsesActiveProjectWithoutIndependentPicker[\s\S]*testContextualNewChatBlocksStartWhenFixedFamiliarLeavesActiveProject[\s\S]*testContextualNewChatShowsRecoveryOnlyGuidanceForUnassigned/,
  "simulator tests must cover the fixed active root, revoked access, and Unassigned recovery-only states",
);
assert.match(
  snapshotTests,
  /testLegacySnapshotWithoutProjectRootStillDecodes/,
  "legacy snapshots without projectRoot must remain decodable",
);
assert.match(
  runner,
  /mobile:\s*\[[\s\S]*"scripts\/ios-chat-project-contract\.test\.mjs"/,
  "the Linux-friendly iOS project contract guard must run in pnpm test:mobile",
);

console.log("ios-chat-project-contract.test.mjs: ok");
