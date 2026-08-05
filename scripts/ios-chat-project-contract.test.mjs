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
  newChat,
  chat,
  picker,
  home,
  familiarThreads,
  nativeContractTests,
  nativeSelectionTests,
  snapshotTests,
  runner,
] = await Promise.all([
  read(`${iosRoot}/Models/Models.swift`),
  read(`${iosRoot}/Models/DevModels.swift`),
  read(`${iosRoot}/Networking/CaveClient.swift`),
  read(`${iosRoot}/Networking/CaveConnection.swift`),
  read(`${iosRoot}/State/ChatThread.swift`),
  read(`${iosRoot}/State/AppModel.swift`),
  read(`${iosRoot}/Views/NewChatView.swift`),
  read(`${iosRoot}/Views/ChatView.swift`),
  read(`${iosRoot}/Views/ChatProjectPicker.swift`),
  read(`${iosRoot}/Views/ChatsHomeView.swift`),
  read(`${iosRoot}/Views/FamiliarThreadsView.swift`),
  read("apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/ChatProjectSelectionTests.swift"),
  read("apps/ios/CovenCave/CovenCaveTests/ThreadSnapshotStoreTests.swift"),
  read("scripts/run-tests.mjs"),
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
  /currentClient\.projects\(familiarIds: familiarKey\)/,
  "the picker must request projects scoped to every selected familiar",
);
assert.match(
  picker,
  /let refreshToken: Int[\s\S]*var onManageAccess: \(\(\) -> Void\)\?/,
  "the picker must require a caller-driven refresh token and keep access repair optional",
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
  /private var canLaunchChat: Bool \{[\s\S]*!isMissingFixedFamiliar[\s\S]*!selected\.isEmpty[\s\S]*projectResolved[\s\S]*selectedProjectRoot != nil[\s\S]*\}/,
  "launch gating must require a live fixed familiar, selected familiars, and a resolved project",
);
assert.match(
  newChat,
  /Label\("Import from Markdown…", systemImage: "square\.and\.arrow\.down"\)[\s\S]*\.disabled\(!canLaunchChat\)[\s\S]*Button\(isGroup \? "Create" : "Start"\)\s*\{[\s\S]*\.disabled\(!canLaunchChat\)/,
  "Import and Start controls must stay disabled until launch is allowed",
);
assert.match(
  newChat,
  /Section\("Project"\) \{[\s\S]*ChatProjectPicker\([\s\S]*familiarIds: selectedFamiliarIds[\s\S]*selectedRoot: \$selectedProjectRoot[\s\S]*isResolved: \$projectResolved[\s\S]*\)/,
  "New Chat must retain project selection and its bindings",
);
assert.match(
  newChat,
  /let fixedFamiliarId: String\?[\s\S]*if fixedFamiliarId == nil[\s\S]*Section\(selected\.isEmpty \? "Choose familiars" :/,
  "fixed familiar mode must hide the editable familiar roster",
);
assert.match(
  newChat,
  /private var isMissingFixedFamiliar: Bool \{[\s\S]*fixedFamiliarId != nil && fixedFamiliar == nil[\s\S]*\}/,
  "stale fixed familiars must be detected as a non-launchable state",
);
assert.match(
  newChat,
  /private var canLaunchChat: Bool \{[\s\S]*!isMissingFixedFamiliar[\s\S]*!selected\.isEmpty[\s\S]*projectResolved[\s\S]*selectedProjectRoot != nil[\s\S]*\}/,
  "launch controls must stay blocked when the fixed familiar is stale",
);
assert.match(
  newChat,
  /@State private var showProjectAccess = false[\s\S]*@State private var projectRefreshToken = 0/,
  "fixed familiar mode must track project access sheet state and refresh tokens",
);
assert.match(
  newChat,
  /ChatProjectPicker\([\s\S]*refreshToken:\s*projectRefreshToken[\s\S]*onManageAccess:\s*fixedFamiliar(?:Id)?\s*==\s*nil\s*\?\s*nil\s*:\s*\{\s*showProjectAccess\s*=\s*true\s*\}/,
  "fixed familiar mode must wire project access repair through the picker",
);
assert.match(
  newChat,
  /ChatProjectPicker\([\s\S]*refreshToken:\s*projectRefreshToken[\s\S]*onResolved:\s*nil/,
  "new chats must pass the managed refresh token to the picker",
);
assert.match(
  newChat,
  /init\([\s\S]*initialFamiliarIds:\s*\[String\]\s*=\s*\[\][\s\S]*fixedFamiliarId:\s*String\?\s*=\s*nil[\s\S]*(?:let\s+\w+\s*=\s*fixedFamiliarId\.map\s*\{\s*\[\$0\]\s*\}\s*\?\?\s*initialFamiliarIds[\s\S]*_selected\s*=\s*State\(initialValue:\s*Set\(\s*\w+\s*\)|_selected\s*=\s*State\(initialValue:\s*Set\(fixedFamiliarId\.map\s*\{\s*\[\$0\]\s*\}\s*\?\?\s*initialFamiliarIds\)\))/,
  "fixed familiar launches must seed the selected roster from the fixed familiar when present",
);
assert.match(
  newChat,
  /if isMissingFixedFamiliar \{\s*Section \{\s*Label\(\s*"This familiar is no longer available\."\s*,\s*systemImage:\s*"person\.crop\.circle\.badge\.exclamationmark"\s*\)[\s\S]*?Text\(\s*"Refresh Chats and try again\."\s*\)[\s\S]*?\}\s*\}\s*else \{\s*Section\("Project"\) \{\s*ChatProjectPicker\([\s\S]*?selectedRoot: \$selectedProjectRoot[\s\S]*?isResolved: \$projectResolved[\s\S]*?\)\s*\}\s*\}/,
  "stale fixed familiars must show a utility message before the project section",
);
assert.match(
  newChat,
  /private var selectedFamiliarIds: \[String\] \{[\s\S]*app\.familiars\.map\(\\\.id\)\.filter \{ selected\.contains\(\$0\) \}[\s\S]*\}/,
  "selectedFamiliarIds must only include live roster entries",
);
assert.match(
  newChat,
  /\.sheet\(isPresented:\s*\$showProjectAccess,\s*onDismiss:\s*\{\s*projectRefreshToken\s*\+=\s*1\s*\}\)/,
  "dismissing project access must refresh the picker token",
);
assert.match(
  newChat,
  /FamiliarPermissionsSheet\(familiar:\s*familiar\)/,
  "the familiar-scoped permissions sheet must render for the fixed familiar",
);
assert.match(
  newChat,
  /startFreshThread\([\s\S]*projectRoot: selectedProjectRoot[\s\S]*createGroup\([\s\S]*projectRoot: selectedProjectRoot/,
  "direct and group constructors must persist the selected root",
);
assert.match(
  appModel,
  /func createGroup\([\s\S]*projectRoot: String[\s\S]*ChatThread\([\s\S]*projectRoot: projectRoot/,
  "group creation must require a project root",
);
assert.match(
  appModel,
  /func importMarkdown\([\s\S]*familiarIds preferredFamiliarIds: \[String\][\s\S]*projectRoot: String\?[\s\S]*ChatThread\([\s\S]*familiarIds: familiarIds,[\s\S]*projectRoot: projectRoot/,
  "Markdown imports must retain selected familiars and project provenance",
);
assert.match(
  appModel,
  /ChatProjectSelection\.importedFamiliarIDs\([\s\S]*preferred: preferredFamiliarIds,[\s\S]*discovered: discoveredFamiliarIds/,
  "explicit import participants must remain the project-authorized send scope",
);
assert.match(
  newChat,
  /importMarkdown\([\s\S]*familiarIds: selectedFamiliarIds,[\s\S]*projectRoot: selectedProjectRoot/,
  "the import constructor must receive the resolved New Chat context",
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
  /startFreshThread\(familiarIds: thread\.familiarIds,[\s\S]*projectRoot: thread\.projectRoot\)/,
  "/new must preserve the current project context",
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
