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
  /client\.projects\(familiarIds: familiarKey\)/,
  "the picker must request projects scoped to every selected familiar",
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
assert.match(
  picker,
  /if locked \{[\s\S]*lockedProject[\s\S]*Start a new chat to use another project\./,
  "the project must become read-only after the first server session",
);
assert.doesNotMatch(
  picker,
  /guard let client = app\.client else \{[\s\S]*?selectedRoot = nil[\s\S]*?return/,
  "a transient connection outage must not erase persisted project provenance",
);
assert.doesNotMatch(
  picker,
  /catch \{[\s\S]*?projects = \[\][\s\S]*?selectedRoot = nil[\s\S]*?errorMessage = error\.localizedDescription/,
  "a project-list failure must not erase the last persisted project root",
);

// All user-visible constructors route through selection and preserve the root.
assert.match(
  newChat,
  /ChatProjectPicker\([\s\S]*familiarIds: selectedFamiliarIds[\s\S]*\.disabled\([\s\S]*!projectResolved[\s\S]*selectedProjectRoot == nil/,
  "New Chat must remain blocked until the scoped project resolves",
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
  /ChatProjectPicker\([\s\S]*selectedRoot: \$thread\.projectRoot[\s\S]*locked: !thread\.canChangeProject[\s\S]*requiresExplicitSelection: thread\.needsProjectSelection/,
  "Chat must repair legacy/stale threads and lock server-owned provenance",
);
assert.match(
  chat,
  /if thread\.needsProjectSelection \|\| !thread\.canSendMessages \{[\s\S]*?ChatProjectPicker\(/,
  "resolved chats must not keep a persistent Project control above the composer",
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
  /NewChatView\(initialFamiliarIds: initialNewChatFamiliarIds\)[\s\S]*presentNewChat\(familiarIds: \[familiar\.id\]\)/,
  "home familiar shortcuts must enter the project-aware New Chat flow",
);
assert.match(
  familiarThreads,
  /NewChatView\(initialFamiliarIds: \[familiar\.id\]\)/,
  "familiar history shortcuts must enter the project-aware New Chat flow",
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
