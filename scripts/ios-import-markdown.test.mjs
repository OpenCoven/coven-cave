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
assert.match(importContext, /init\?\(\s*selectedProject: ProjectInfo\?,\s*selectedFamiliarIds: \[String\]\s*\)/, "launch context capture should require the local project and selected roster");
assert.match(importContext, /let familiarIds = ChatProjectSelection\.familiarKey\(selectedFamiliarIds\)[\s\S]*guard !projectId\.isEmpty,[\s\S]*!projectRoot\.isEmpty,[\s\S]*!familiarIds\.isEmpty else \{ return nil \}/, "captured imports must never proceed with an empty preferred roster");
assert.match(importContext, /func validate\([\s\S]*registeredProjects: \[ProjectInfo\],[\s\S]*accessibleProjects: \[ProjectInfo\],[\s\S]*projectMembership: ProjectMembershipIndex,[\s\S]*membershipLoaded: Bool/, "launch context must validate against fresh registration and accessible scopes");
assert.match(importContext, /guard registeredProjects\.contains\(where: \{[\s\S]*\$0\.id == projectId && \$0\.root == projectRoot[\s\S]*return \.projectChanged/, "validation must reject changes to the exact captured registration");
assert.match(importContext, /let revokedFamiliarIds = familiarIds\.filter \{[\s\S]*!projectMembership\.contains\(\$0, inProjectID: projectId\)/, "validation must fail closed when any selected familiar loses project access");
assert.doesNotMatch(importContext, /activeProject|projectContext:/, "ambient changes must not retarget or cancel a valid local import");

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
assert.match(newChat, /let context = NewChatImportLaunchContext\([\s\S]*selectedProject: selectedProject,[\s\S]*selectedFamiliarIds: selectedFamiliarIds[\s\S]*\)[\s\S]*importLaunchContext = context[\s\S]*importingFile = true/, "Import should freeze its local project and roster before presenting the picker");
assert.match(newChat, /private func importFromFile[\s\S]*let context = importLaunchContext[\s\S]*importLaunchContext = nil[\s\S]*importConnectionLease = nil/, "picker callbacks consume the captured launch context exactly once");
assert.match(newChat, /guard await validate\(context, lease: lease\) else \{ return \}[\s\S]*app\.importMarkdown\(/, "picker callbacks must revalidate captured access before import");
assert.match(newChat, /case \.accessUnavailable:[\s\S]*reportLaunchError\(/, "missing grants must abort with actionable guidance");
assert.match(newChat, /case \.projectChanged:[\s\S]*reportLaunchError\(/, "changed registrations must abort with guidance");
assert.match(newChat, /case \.familiarAccessRevoked\(let ids\):[\s\S]*reportLaunchError\(/, "revoked access must abort with guidance");
assert.match(newChat, /app\.importMarkdown\([\s\S]*familiarIds: context\.familiarIds,[\s\S]*projectRoot: context\.projectRoot/, "imports must use captured project and roster rather than callback state");
assert.match(newChat, /startAccessingSecurityScopedResource\(\)/, "accesses the security-scoped file");

console.log("ios-import-markdown.test.mjs: ok");
