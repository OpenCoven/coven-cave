import SwiftUI

/// A file to open in the editor.
struct FileRef: Hashable {
    var path: String
    var name: String
}

/// Code section: a single merged explorer. Projects expand **inline** to their
/// file trees (lazy, recursive) instead of drilling into a separate screen —
/// mirroring the desktop comux merge where the project switcher and the file
/// tree share one column. A file opens in the editor; project-wide search runs
/// against the project you last opened.
struct CodeBrowserView: View {
    @Environment(AppModel.self) private var app

    @State private var query = ""
    @State private var focusedRoot: String?
    @State private var focusedName = ""
    @State private var results: [SearchFile] = []
    @State private var searching = false
    @State private var searchTruncated = false

    private var searchActive: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Code")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: FileRef.self) { file in
                    CodeEditorView(path: file.path, name: file.name)
                }
                .searchable(
                    text: $query,
                    prompt: focusedRoot == nil ? "Open a project to search it" : "Search \(focusedName)"
                )
                .task(id: query) { await runSearch() }
                .refreshable { await app.loadProjects() }
                .task { if !app.projectsLoaded { await app.loadProjects() } }
        }
    }

    @ViewBuilder private var content: some View {
        if !app.projectsLoaded {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = app.projectsError, app.projects.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load projects", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: {
                Button("Retry") { Task { await app.loadProjects() } }.buttonStyle(.borderedProminent)
            }
        } else if app.projects.isEmpty {
            ContentUnavailableView {
                Label("No projects", systemImage: "folder.badge.questionmark")
            } description: {
                Text("Add a project on the desktop and it’ll appear here.")
            }
        } else if searchActive && focusedRoot != nil {
            searchResults
        } else {
            tree
        }
    }

    // MARK: - Merged tree (projects + files in one explorer)

    private var tree: some View {
        List {
            ForEach(app.projects) { project in
                CodeNode(
                    path: project.root,
                    name: project.name,
                    isDir: true,
                    searchRoot: project.root,
                    isProject: true,
                    autoExpand: true,
                    color: Color(hex: project.color) ?? .accentColor,
                    onFocusProject: {
                        focusedRoot = project.root
                        focusedName = project.name
                    }
                )
            }
        }
        .listStyle(.plain)
        .themedListBackground()
    }

    // MARK: - Search (scoped to the focused project)

    @ViewBuilder private var searchResults: some View {
        if searching {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if results.isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            List {
                if searchTruncated {
                    Text("Showing first matches — refine to narrow.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(results) { file in
                    Section {
                        ForEach(file.matches) { match in
                            NavigationLink(value: FileRef(path: absolute(file.path),
                                                          name: lastComponent(file.path))) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(match.preview.trimmingCharacters(in: .whitespaces))
                                        .font(.caption.monospaced())
                                        .lineLimit(2)
                                    Text("line \(match.line)")
                                        .font(.caption2).foregroundStyle(.tertiary)
                                }
                            }
                        }
                    } header: {
                        Text(file.path).font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .themedListBackground()
        }
    }

    private func runSearch() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2, let root = focusedRoot, let client = app.client else {
            results = []; searchTruncated = false; return
        }
        // Light debounce so each keystroke doesn't spawn a ripgrep run.
        try? await Task.sleep(for: .milliseconds(300))
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        do {
            let resp = try await client.searchProject(root: root, query: q)
            if Task.isCancelled { return }
            results = resp.files ?? []
            searchTruncated = resp.truncated ?? false
        } catch {
            results = []; searchTruncated = false
        }
    }

    private func absolute(_ relative: String) -> String {
        guard let root = focusedRoot else { return relative }
        return root.hasSuffix("/") ? root + relative : root + "/" + relative
    }

    private func lastComponent(_ p: String) -> String {
        p.split(separator: "/").last.map(String.init) ?? p
    }
}

/// One node in the merged tree. A project or directory expands inline (lazy) to
/// its children; a file opens in the editor. Recursive.
struct CodeNode: View {
    @Environment(AppModel.self) private var app
    let path: String
    let name: String
    let isDir: Bool
    let searchRoot: String
    var isProject = false
    var autoExpand = false
    var color: Color? = nil
    var onFocusProject: (() -> Void)? = nil

    @State private var expanded = false
    @State private var children: [TreeEntry] = []
    @State private var loaded = false
    @State private var loading = false

    var body: some View {
        if isDir {
            DisclosureGroup(isExpanded: $expanded) {
                if loading && !loaded {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Loading…").font(.caption).foregroundStyle(.secondary)
                    }
                } else if loaded && children.isEmpty {
                    Text("Empty folder").font(.caption).foregroundStyle(.tertiary)
                } else {
                    ForEach(children) { entry in
                        CodeNode(path: entry.path, name: entry.name, isDir: entry.isDir, searchRoot: searchRoot)
                    }
                }
            } label: {
                rowLabel
            }
            .onChange(of: expanded) { _, isExpanded in
                if isExpanded {
                    expandAndLoad()
                }
            }
            .onAppear {
                if autoExpand { expandAndLoad() }
            }
        } else {
            NavigationLink(value: FileRef(path: path, name: name)) {
                Label {
                    Text(name).font(.subheadline)
                } icon: {
                    Image(systemName: fileIcon(name)).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private var rowLabel: some View {
        if isProject {
            HStack(spacing: 9) {
                Capsule()
                    .fill(color ?? .accentColor)
                    .frame(width: 3, height: 18)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.subheadline.weight(.semibold))
                    Text(compactPath(path))
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
        } else {
            Label {
                Text(name).font(.subheadline)
            } icon: {
                Image(systemName: "folder").foregroundStyle(.secondary)
            }
        }
    }

    private func expandAndLoad() {
        if !expanded { expanded = true }
        if isProject { onFocusProject?() }
        guard !loaded, !loading else { return }
        Task { await load() }
    }

    private func load() async {
        guard let client = app.client else { return }
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            children = try await client.projectTree(root: path, depth: 1)
            loaded = true
        } catch {
            // leave loaded == false so collapsing + re-expanding retries
        }
    }

    private func compactPath(_ path: String) -> String {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count > 3 else { return path }
        return ".../" + parts.suffix(3).joined(separator: "/")
    }
}

/// SF Symbol for a file based on its extension.
func fileIcon(_ name: String) -> String {
    let ext = name.split(separator: ".").last.map(String.init)?.lowercased() ?? ""
    switch ext {
    case "swift", "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "go", "py", "rb",
         "c", "h", "cpp", "hpp", "java", "kt", "lua", "zig":
        return "chevron.left.forwardslash.chevron.right"
    case "json", "yaml", "yml", "toml", "xml", "ini", "conf", "cfg", "lock",
         "plist", "pbxproj", "xcconfig", "gradle", "properties", "csv", "tsv":
        return "doc.text.fill"
    case "md", "markdown", "mdx":
        return "doc.richtext"
    case "txt", "text", "log", "out", "err", "trace":
        return "doc.plaintext"
    case "diff", "patch":
        return "plusminus"
    case "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp":
        return "photo"
    case "css", "html":
        return "paintbrush"
    case "sh":
        return "terminal"
    default:
        return "doc"
    }
}
