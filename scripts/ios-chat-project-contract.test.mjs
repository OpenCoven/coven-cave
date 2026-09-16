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
  /else if projects\.isEmpty \{[\s\S]*if let onManageAccess \{[\s\S]*Button\("Project access", action: onManageAccess\)/,
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
  /if selectedRoot == nil, !requiresExplicitSelection \{[\s\S]*ChatProjectSelection\.resolvedRoot\([\s\S]*current: nil,[\s\S]*recent: recentRoots,[\s\S]*projects: loaded/,
  "optional defaults may seed only an untouched selection",
);
assert.match(
  picker,
  /isResolved = loaded\.contains \{ \$0\.root == selectedRoot \}/,
  "a revoked selection must become unresolved rather than silently switching projects",
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
  /@State private var selectedProject: ProjectInfo\?/,
  "New Chat must own its selected registered project",
);
assert.match(
  newChat,
  /private var canLaunchChat: Bool \{[\s\S]*projectResolved && selectedProject != nil[\s\S]*!selectedFamiliarIds\.isEmpty && !isLaunching/,
  "launch gating must require a resolved local project and stable nonempty roster",
);
assert.match(
  newChat,
  /Label\("Import from Markdown…", systemImage: "square\.and\.arrow\.down"\)[\s\S]*\.disabled\(!canLaunchChat\)[\s\S]*Button\(isGroup \? "Create group" : "Start chat"\)\s*\{[\s\S]*\.disabled\(!canLaunchChat\)/,
  "Import and Start controls must stay disabled until launch is allowed",
);
assert.match(
  newChat,
  /Section\("Chat access"\) \{[\s\S]*ChatProjectPicker\([\s\S]*requiresExplicitSelection: true/,
  "New Chat must offer explicit chat-local project access",
);
assert.match(
  newChat,
  /fixedFamiliarId == nil \|\| \$0\.id == fixedFamiliarId[\s\S]*\.disabled\(fixedFamiliarId != nil\)/,
  "fixed familiar mode must preserve its immutable familiar roster",
);
assert.doesNotMatch(
  newChat,
  /app\.(?:activeProject|activeProjectRoot|projectContext|projectFamiliars)\b/,
  "New Chat must never depend on the ambient project filter",
);
assert.match(
  newChat,
  /case \.familiarAccessRevoked\(let ids\):[\s\S]*Project access was revoked/,
  "launch must surface revoked participant access",
);
assert.match(
  newChat,
  /private var selectedFamiliarIds: \[String\] \{[\s\S]*ChatProjectSelection\.familiarKey\(Array\(selected\)\)/,
  "roster refresh must not silently remove chosen participants",
);
assert.match(
  newChat,
  /init\([\s\S]*initialFamiliarIds:\s*\[String\]\s*=\s*\[\][\s\S]*fixedFamiliarId:\s*String\?\s*=\s*nil[\s\S]*(?:let\s+\w+\s*=\s*fixedFamiliarId\.map\s*\{\s*\[\$0\]\s*\}\s*\?\?\s*initialFamiliarIds[\s\S]*_selected\s*=\s*State\(initialValue:\s*Set\(\s*\w+\s*\)|_selected\s*=\s*State\(initialValue:\s*Set\(fixedFamiliarId\.map\s*\{\s*\[\$0\]\s*\}\s*\?\?\s*initialFamiliarIds\)\))/,
  "fixed familiar launches must seed the selected roster from the fixed familiar when present",
);
assert.match(
  newChat,
  /startFreshThread\([\s\S]*projectRoot: context\.projectRoot[\s\S]*createGroup\([\s\S]*projectRoot: context\.projectRoot/,
  "direct and group constructors must always persist the captured project root",
);
assert.match(
  newChat,
  /let context = NewChatImportLaunchContext\([\s\S]*selectedProject: selectedProject,[\s\S]*selectedFamiliarIds: selectedFamiliarIds[\s\S]*\)[\s\S]*importLaunchContext = context[\s\S]*importConnectionLease = app\.captureConnectionDispatchLease\(\)[\s\S]*importingFile = true/,
  "imports must freeze the local project, roster, and connection before opening the picker",
);
assert.match(
  newChat,
  /guard await validate\(context, lease: lease\) else \{ return \}[\s\S]*importMarkdown\([\s\S]*familiarIds: context\.familiarIds,[\s\S]*projectRoot: context\.projectRoot/,
  "imports must revalidate captured access before committing the imported thread",
);
assert.match(
  newChat,
  /await app\.refreshChatAccess\(\)[\s\S]*app\.loadChatProjects\(familiarIds: context\.familiarIds\)[\s\S]*connectionDispatchLeaseIsCurrent\(lease\)[\s\S]*membershipLoaded: app\.projectMembershipLoaded && app\.projectContextError == nil/,
  "every commit must freshly verify exact local selection and membership on the captured connection",
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
  /func startFreshThread\(\s*in context: ProjectContext\?[\s\S]*guard projectMembershipLoaded, projectContextError == nil[\s\S]*projectMembership\.contains\(\$0, in: boundProject\)/,
  "/new and replacement helpers must validate every participant against the supplied object's project",
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
  /\.sheet\(isPresented: \$showNewChat\) \{\s*NewChatView\(initialFamiliarIds: thread\.familiarIds\)/,
  "/new and replacement flows must preserve participants in explicit New Chat configuration",
);
assert.match(
  chat,
  /if isRecoveryOnlyThread \{[\s\S]*recoveryOnlyComposer[\s\S]*\} else \{[\s\S]*composer[\s\S]*\}/,
  "established projectless chats must replace the composer with recovery-only guidance",
);
assert.match(
  chat,
  /private var recoveryOnlyComposer: some View[\s\S]*Button\("Start replacement chat", action: startReplacementChat\)[\s\S]*private func startReplacementChat\(\) \{\s*showNewChat = true\s*\}/,
  "recovery-only chats must open local project selection without requiring an ambient project",
);
assert.match(
  chat,
  /app\.markThreadViewed\(thread\)/,
  "opening a chat must clear only that thread's unread state",
);
assert.doesNotMatch(
  chat,
  /app\.markFamiliarViewed\(/,
  "opening one chat must not clear unread state for sibling conversations",
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
  /private func beginVoiceCall\(\) \{[\s\S]*let callThread = thread[\s\S]*voiceCall = LiveVoiceCallModel\([\s\S]*sessionId: launch\.sessionId,[\s\S]*projectRoot: launch\.projectRoot,[\s\S]*onSessionEstablished: \{ sessionId in[\s\S]*app\.bindThreadSession\(sessionId, to: callThread, for: familiarId\)[\s\S]*onSessionDiscarded: \{ sessionId in[\s\S]*callThread\.sessionIds\.removeValue\(forKey: familiarId\)[\s\S]*onCleanupWarning: \{ message in[\s\S]*app\.showToast\(message,[\s\S]*style: \.warning\)/,
  "ChatView must freeze voice provenance and keep session binding, orphan cleanup, and warnings on the captured conversation",
);
assert.match(
  chat,
  /onSessionEstablished: \{ sessionId in[\s\S]*guard app\.connectionDispatchLeaseIsCurrent\(dispatchLease\),\s*binding\.matches\(callThread, includingSessions: true\) else \{ return \}[\s\S]*app\.bindThreadSession\(sessionId, to: callThread, for: familiarId\)/,
  "voice-session binding must verify the captured connection and session identity before persisting",
);
assert.match(
  chat,
  /onSessionDiscarded: \{ sessionId in[\s\S]*guard app\.connectionDispatchLeaseIsCurrent\(dispatchLease\),\s*binding\.matches\(callThread, includingSessions: true\),\s*callThread\.sessionIds\[familiarId\] == sessionId else \{ return \}[\s\S]*callThread\.sessionIds\.removeValue\(forKey: familiarId\)[\s\S]*app\.touch\(callThread\)/,
  "discarded auto-created voice sessions must remove only the matching captured local binding",
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
  /private func completeProjectNavigation\([\s\S]*selectedTab = intent\.resolvedDestination[\s\S]*if let thread \{[\s\S]*threadToOpen = thread/,
  "the shared resolver must publish the chosen chat object",
);
assert.doesNotMatch(
  appModel.split("private func completeProjectNavigation(")[1].split("private func announceProjectNavigationSwitch")[0],
  /switchProject|projectContext\s*=/,
  "opening an object must not rescope the shell",
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
  /private func startRealtime\(generation: Int\) async \{[\s\S]*guard let projectRoot = state\.projectRoot else \{[\s\S]*projectRequiredCopy[\s\S]*\}[\s\S]*let sessionId = try await realtimeSessionID\(client: client, projectRoot: projectRoot\)\s*guard canContinueLaunch\(generation\) else \{ return \}[\s\S]*mintVoiceSession\([\s\S]*familiarId: familiar\.id,\s*sessionId: sessionId\s*\)\s*guard canContinueLaunch\(generation\) else \{ return \}/,
  "realtime voice must mint project-scoped grants only while its captured launch remains current across suspensions",
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
  /func requestOpenGlobalFamiliarLandingThread\(for familiarId: String\)[\s\S]*globalLandingDirectThread\(for: familiarId\)[\s\S]*globalServerOnlySessions\(for: familiarId\)[\s\S]*Open New chat to choose this familiar and its project access/,
  "global familiar opens may reuse history but cannot silently synthesize an ambient-project chat",
);
assert.doesNotMatch(
  root,
  /case \.familiars: FamiliarsListView/,
  "the retired global familiar hub must not remain in the root shell",
);
assert.doesNotMatch(
  root,
  /GlobalSearchView\(/,
  "the root must not mount retired global search",
);
assert.match(
  appModel,
  /func requestOpenProjectSearchResult\([\s\S]*selectedTab\.projectSearchReturnDestination[\s\S]*func requestOpenServerSession\(/,
  "AppModel must centralize project-search destination policy and server-session opens",
);
assert.match(
  chat,
  /case \.command\(let command, let args\):[\s\S]*if command\.sendsChatMessage \{[\s\S]*guard requireChatAccess\(\) else \{ return \}[\s\S]*guard thread\.canSendMessages else \{[\s\S]*thread\.needsProjectSelection = true[\s\S]*return[\s\S]*draft = ""/,
  "message-producing commands must preserve drafts until access and provenance resolve",
);
const chatBootstrap = appModel.split("private func resolveProjectContextSelection(")[1]
  .split("private func applyProjectContextSelection(")[0];
assert.doesNotMatch(chatBootstrap, /coordinatedTasksLoad|client\.tasks\(/,
  "chat bootstrap must not hydrate retired tasks");
assert.match(appModel, /func resolvePendingProjectNavigationIntent[\s\S]*guard intent\.resolvedDestination != \.tasks else \{[\s\S]*showDesktopOnlyDestination\(\)[\s\S]*if attemptHydrationIfNeeded/,
  "retired task navigation must reject before any hydration");
assert.match(appModel, /var chatAccessIsCurrent: Bool \{[\s\S]*projectsLoaded && projectMembershipLoaded && projectContextError == nil/,
  "cached history cannot stand in for current send access");
assert.match(appModel, /func chatAccessIsCurrent\(projectRoot: String\?, familiarIds: \[String\]\) -> Bool \{[\s\S]*let targets = Set\(familiarIds\)[\s\S]*guard chatAccessIsCurrent,[\s\S]*!targets\.isEmpty,[\s\S]*ProjectContext\.openContext\(for: projectRoot, in: projects\),\s*project\.root == projectRoot[\s\S]*targets\.allSatisfy \{ projectMembership\.contains\(\$0, in: project\) \}/,
  "write access must resolve the bound project and require current membership for every exact recipient");
const queuedReplay = appModel.split("func flushQueuedMessages() {")[1]
  .split("/// Rolling renewal:")[0];
assert.match(queuedReplay, /targetAccessIsCurrent: \{ \[weak self\] projectRoot, familiarId in[\s\S]*chatAccessIsCurrent\(\s*projectRoot: projectRoot,\s*familiarIds: \[familiarId\]/,
  "queue dispatch must authorize the frozen recipient supplied by replay, not the current roster");
assert.match(queuedReplay, /onAccessRefused:[\s\S]*showToast\([\s\S]*original recipients have been kept/,
  "revoked queued access must be explained without discarding or retargeting the message");
const targetReplay = thread.split("func replayQueued(client: CaveClient,")[1]
  .split("/// Remove one message")[0];
assert.match(targetReplay, /targetAccessIsCurrent: @escaping \(String\?, String\) -> Bool/,
  "queued replay requires a per-target authorization callback");
assert.match(targetReplay, /let targets = queuedMessage\.queuedTargetFamiliarIds[\s\S]*let queuedProjectRoot = queuedContext\.projectRoot[\s\S]*for familiarId in targets where !completed\.contains\(familiarId\)[\s\S]*let queuedSessionId = queuedContext\.sessionIds\[familiarId\] \?\? sessionIds\[familiarId\][\s\S]*targetAccessIsCurrent\(queuedProjectRoot, familiarId\)[\s\S]*guard mayDispatchTarget\(\) else \{ continue \}[\s\S]*let existingPlaceholder/,
  "every frozen queued recipient must pass authorization before a placeholder, reconciliation, or write checkpoint");
assert.match(targetReplay, /await persistBeforeDispatch\(\)[\s\S]*guard !Task\.isCancelled, dispatchLeaseIsCurrent\(\), mayDispatchTarget\(\) else[\s\S]*liveDispatchLeaseIsCurrent: mayDispatchTarget/,
  "recipient/root authorization must run after persistence and inside the actual stream preflight");
assert.match(targetReplay, /guard targets\.allSatisfy\(\{ completed\.contains\(\$0\) \}\) else \{ return \}\s*mutate\(queuedId\)/,
  "a refused group target must keep the queue pending after allowed recipients finish");
assert.match(nativeAppContextTests, /testChatWriteAccessUsesBoundProjectAndExactRosterNotReadability[\s\S]*testRevokedQueuedRecipientCannotBeReplacedByCurrentRosterAccess[\s\S]*testQueuedAccessPreservesLegacyRunRecipientFallback/,
  "native tests must distinguish readable history, exact write access, and frozen legacy queue targets");
assert.match(nativeAppContextTests, /testSuccessfulGrantRefreshRevocationLeavesQueuedRecipientUnsent[\s\S]*testFrozenQueuedGroupSkipsRevokedTargetWithoutStarvingAllowedRecipient[\s\S]*testGrantRevocationDuringQueuedPersistenceRollsBackWithoutPost[\s\S]*testQueuedGrantRevocationAtNetworkPreflightPreservesPendingLeg/,
  "native tests must cover successful grant revocation, allowed siblings, checkpoint races, and final network preflight");
assert.doesNotMatch(nativeAppContextTests, /FamiliarDetailStatsModel/,
  "state tests must not retain the removed familiar task-analytics model");
const shellReadiness = appModel.split("var hasLoadedSurfaces: Bool {")[1].split("\n    }")[0];
assert.match(shellReadiness, /!chatThreads\.isEmpty \|\| !chatServerSessions\.isEmpty/,
  "cold cached history must keep the shell readable without a live project catalog");
assert.doesNotMatch(shellReadiness, /tasksLoaded|remindersLoaded/,
  "retired non-chat data cannot make the chat shell ready");
assert.match(appModel, /let shouldLoadCoreBeforeDispatch = !chatAccessIsCurrent[\s\S]*if shouldLoadCoreBeforeDispatch/,
  "readable cached history must not skip access bootstrap before queued dispatch");
assert.match(
  home,
  /NewChatView\([\s\S]*fixedFamiliarId: fixedNewChatFamiliarId/,
  "home must preserve fixed-familiar New Chat support",
);
assert.match(
  home,
  /enum ChatNewConversationContext[\s\S]*static func fixedFamiliarId\([\s\S]*detailPath\.last \?\? selection/,
  "Chats must resolve New Chat context from the visible detail route before the sidebar selection",
);
assert.match(
  nativeAppContextTests,
  /testRequestOpenPreservesAmbientProjectBeforeOpening[\s\S]*testRequestOpenPreservesAmbientProjectForProjectlessThread[\s\S]*testRequestOpenTaskRejectsDesktopOnlyDestination[\s\S]*testRequestOpenServerSessionPreservesAmbientProjectBeforeOpening[\s\S]*testPendingTaskNavigationIsRejectedBeforeHydration/,
  "native app-context tests must cover non-rescoping object opens and fail-fast retired navigation",
);
assert.match(
  home,
  /private func presentContextualNewChat\(\)[\s\S]*ChatNewConversationContext\.fixedFamiliarId\([\s\S]*selection: selection,[\s\S]*detailPath: detailPath/,
  "contextual compose must derive its fixed familiar from the visible Chats route",
);
assert.match(
  home,
  /Button \{\s*presentContextualNewChat\(\)\s*\} label:[\s\S]{0,800}accessibilityLabel\("New chat"\)/,
  "the Chats compose control must use contextual New Chat",
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
  /testRequestOpenGlobalFamiliarLandingThreadPrefersMostRecentLocalLandingAcrossContexts[\s\S]*testRequestOpenGlobalFamiliarLandingThreadMaterializesMostRecentServerOnlySessionAcrossContexts[\s\S]*testGlobalFamiliarWithoutHistoryRequiresChatLocalConfiguration/,
  "native AppModel tests must cover global history reuse and explicit new-chat configuration",
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
  /testContextualNewChatRequiresLocalProjectSelection[\s\S]*testContextualNewChatBlocksCommitWhenAccessIsRevoked[\s\S]*testNewChatCanConfigureAccessWithoutAmbientProject/,
  "simulator tests must cover explicit selection, revoked access, and a missing ambient project",
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
