import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const importContext = await read(`${iosRoot}/Models/NewChatImportLaunchContext.swift`);
const parser = await read(`${iosRoot}/Views/ThreadImport.swift`);
const model = await read(`${iosRoot}/State/AppModel.swift`);
const newChat = await read(`${iosRoot}/Views/NewChatView.swift`);

// New Chat captures a project-scoped launch context before opening the picker
// and revalidates the same project/root + roster on callback.
assert.match(importContext, /struct NewChatImportLaunchContext: Equatable, Sendable/, "New Chat import should capture a dedicated launch context");
assert.match(importContext, /init\?\(\s*activeProject: ProjectInfo\?,\s*selectedFamiliarIds: \[String\]\s*\)/, "launch context capture should require the active project and selected roster");
assert.match(importContext, /let familiarIds = ChatProjectSelection\.familiarKey\(selectedFamiliarIds\)[\s\S]*guard !projectId\.isEmpty,[\s\S]*!projectRoot\.isEmpty,[\s\S]*!familiarIds\.isEmpty else \{ return nil \}/, "captured imports must never proceed with an empty preferred roster");
assert.match(importContext, /func validate\([\s\S]*projectContext: ProjectContext\?,[\s\S]*activeProject: ProjectInfo\?,[\s\S]*projectMembership: ProjectMembershipIndex[\s\S]*\) -> ValidationResult/, "launch context should validate against the current active project state");
assert.match(importContext, /guard activeProjectId == projectId,[\s\S]*activeProjectRoot == projectRoot else \{[\s\S]*return \.projectChanged/, "validation must fail closed when the active project changes");
assert.match(importContext, /let revokedFamiliarIds = familiarIds\.filter \{[\s\S]*!projectMembership\.contains\(\$0, inProjectID: activeProjectId\)/, "validation must fail closed when any selected familiar loses project access");

// Parser pulls title, participants, and **Author**-delimited turns.
assert.match(parser, /func parseThreadMarkdown\(_ text: String\) -> ParsedThread/, "a parser should exist");
assert.match(parser, /struct Turn \{ let who: String; let text: String \}/, "turns carry author + text");
assert.match(parser, /trimmed\.hasPrefix\("# "\)/, "parses the title");
assert.match(parser, /trimmed\.hasPrefix\("_Chat with "\)/, "parses the participant line");
assert.match(parser, /trimmed\.hasPrefix\("\*\*"\), trimmed\.hasSuffix\("\*\*"\)/, "detects author headers");

// Model maps turns to roles and resolves familiars by name.
assert.match(model, /func importMarkdown\([\s\S]*fallbackTitle: String = "Imported chat",[\s\S]*familiarIds preferredFamiliarIds: \[String\] = \[\],[\s\S]*projectRoot: String[\s\S]*\) -> ChatThread/, "AppModel should import Markdown with the active project root");
assert.match(model, /case "you":\s*messages\.append\(DisplayMessage\(role: \.user/, "You maps to a user turn");
assert.match(model, /case "system":\s*messages\.append\(DisplayMessage\(role: \.system/, "System maps to a system turn");
assert.match(model, /displayName\.caseInsensitiveCompare\(name\) == \.orderedSame/, "resolves a familiar by display name");
assert.match(model, /ChatProjectSelection\.importedFamiliarIDs\([\s\S]*preferred: preferredFamiliarIds,[\s\S]*discovered: discoveredFamiliarIds/, "explicit picker participants remain the project-authorized send scope");
assert.match(model, /threads\.insert\(thread, at: 0\)\s*persistThreads\(\)/, "inserts and persists the imported thread");

// NewChatView offers a file importer wired to importMarkdown.
assert.match(newChat, /import UniformTypeIdentifiers/, "imports UTType");
assert.match(newChat, /@State private var importLaunchContext: NewChatImportLaunchContext\?/, "New Chat should retain the captured launch context while the picker is open");
assert.match(newChat, /Button \{ beginImport\(\) \} label: \{[\s\S]*Label\("Import from Markdown…", systemImage: "square\.and\.arrow\.down"\)/, "Import should capture launch context before the picker opens");
assert.match(newChat, /\.fileImporter\([\s\S]*isPresented: \$importingFile/, "presents a file importer");
assert.match(newChat, /let launchContext = NewChatImportLaunchContext\([\s\S]*activeProject: activeProject,[\s\S]*selectedFamiliarIds: selectedFamiliarIds[\s\S]*\)[\s\S]*importLaunchContext = launchContext[\s\S]*importingFile = true/, "Import should freeze the active project + preferred roster before presenting the picker");
assert.match(newChat, /defer \{ importLaunchContext = nil \}/, "picker callbacks should always clear the captured launch context");
assert.match(newChat, /switch launchContext\.validate\([\s\S]*projectContext: app\.projectContext,[\s\S]*activeProject: activeProject,[\s\S]*projectMembership: app\.projectMembership[\s\S]*\)/, "picker callbacks must revalidate the captured project context before import");
assert.match(newChat, /case \.unassigned:[\s\S]*app\.showToast\(/, "Unassigned callbacks must abort with guidance");
assert.match(newChat, /case \.projectChanged:[\s\S]*app\.showToast\(/, "project switches while the picker is open must abort with guidance");
assert.match(newChat, /case \.familiarAccessRevoked\(let revokedFamiliarIds\):[\s\S]*app\.showToast\(/, "access revocation while the picker is open must abort with guidance");
assert.match(newChat, /app\.importMarkdown\([\s\S]*fallbackTitle: fallback,[\s\S]*familiarIds: launchContext\.familiarIds,[\s\S]*projectRoot: launchContext\.projectRoot/, "imports must use the captured project root and preferred roster instead of live callback state");
assert.match(newChat, /startAccessingSecurityScopedResource\(\)/, "accesses the security-scoped file");

console.log("ios-import-markdown.test.mjs: ok");
