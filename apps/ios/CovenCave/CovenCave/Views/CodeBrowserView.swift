import SwiftUI

// Navigation values for the code browser's push stack.

/// A directory level to drill into.
struct DirNode: Hashable {
    var path: String
    var name: String
    var searchRoot: String   // the project root, for project-wide search
}

/// A file to open in the editor.
struct FileRef: Hashable {
    var path: String
    var name: String
}

/// Code section: pick a project, browse its tree, search it, open a file.
struct CodeBrowserView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Projects")
                .navigationDestination(for: DirNode.self) { node in
                    DirectoryView(node: node)
                }
                .navigationDestination(for: FileRef.self) { file in
                    CodeEditorView(path: file.path, name: file.name)
                }
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
                Button("Retry") { Task { await app.loadProjects() } }
                    .buttonStyle(.borderedProminent)
            }
        } else if app.projects.isEmpty {
            ContentUnavailableView {
                Label("No projects", systemImage: "folder.badge.questionmark")
            } description: {
                Text("Add a project on the desktop and it’ll appear here.")
            }
        } else {
            List(app.projects) { project in
                NavigationLink(value: DirNode(path: project.root,
                                              name: project.name,
                                              searchRoot: project.root)) {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color(hex: project.color) ?? .accentColor)
                            .frame(width: 10, height: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(project.name).font(.callout.weight(.medium))
                            Text(project.root)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

/// One directory level: lazy tree listing + project-wide search.
struct DirectoryView: View {
    @Environment(AppModel.self) private var app
    let node: DirNode

    @State private var entries: [TreeEntry] = []
    @State private var loading = true
    @State private var error: String?
    @State private var query = ""
    @State private var results: [SearchFile] = []
    @State private var searching = false
    @State private var searchTruncated = false

    var body: some View {
        Group {
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                searchResults
            } else {
                tree
            }
        }
        .navigationTitle(node.name)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Search this project")
        .task(id: query) { await runSearch() }
        .task { await load() }
    }

    // MARK: Tree

    @ViewBuilder private var tree: some View {
        if loading {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ContentUnavailableView {
                Label("Couldn’t open folder", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: {
                Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
            }
        } else if entries.isEmpty {
            ContentUnavailableView("Empty folder", systemImage: "folder")
        } else {
            List(entries) { entry in
                if entry.isDir {
                    NavigationLink(value: DirNode(path: entry.path,
                                                  name: entry.name,
                                                  searchRoot: node.searchRoot)) {
                        Label(entry.name, systemImage: "folder.fill")
                            .foregroundStyle(.primary)
                    }
                } else {
                    NavigationLink(value: FileRef(path: entry.path, name: entry.name)) {
                        Label {
                            Text(entry.name)
                        } icon: {
                            Image(systemName: fileIcon(entry.name))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private func load() async {
        guard let client = app.client else { return }
        loading = true
        do {
            entries = try await client.projectTree(root: node.path, depth: 1)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    // MARK: Search

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
        }
    }

    private func runSearch() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2, let client = app.client else {
            results = []; searchTruncated = false; return
        }
        // Light debounce so each keystroke doesn't spawn a ripgrep run.
        try? await Task.sleep(for: .milliseconds(300))
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        do {
            let resp = try await client.searchProject(root: node.searchRoot, query: q)
            if Task.isCancelled { return }
            results = resp.files ?? []
            searchTruncated = resp.truncated ?? false
        } catch {
            results = []; searchTruncated = false
        }
    }

    private func absolute(_ relative: String) -> String {
        node.searchRoot.hasSuffix("/") ? node.searchRoot + relative
                                       : node.searchRoot + "/" + relative
    }

    private func lastComponent(_ p: String) -> String {
        p.split(separator: "/").last.map(String.init) ?? p
    }
}

/// SF Symbol for a file based on its extension.
func fileIcon(_ name: String) -> String {
    let ext = name.split(separator: ".").last.map(String.init)?.lowercased() ?? ""
    switch ext {
    case "swift", "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "go", "py", "rb",
         "c", "h", "cpp", "hpp", "java", "kt", "lua", "zig":
        return "chevron.left.forwardslash.chevron.right"
    case "json", "yaml", "yml", "toml", "xml", "ini", "conf", "cfg", "lock":
        return "doc.text.fill"
    case "md", "mdx", "txt":
        return "doc.richtext"
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
