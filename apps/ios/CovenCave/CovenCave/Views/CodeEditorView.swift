import SwiftUI

/// View and edit a single text file (or preview an image). Saves via
/// `POST /api/project-file`, which only overwrites existing text files.
struct CodeEditorView: View {
    @Environment(AppModel.self) private var app
    let path: String
    let name: String

    @State private var loaded: FileContent?
    @State private var loading = true
    @State private var loadError: String?

    @State private var text = ""
    @State private var original = ""
    @State private var saving = false
    @State private var editing = false

    private var isDirty: Bool { text != original }
    private var isEditable: Bool {
        guard let loaded, loaded.ok, loaded.kind == "text" else { return false }
        // Redacted .env reads come back as a placeholder — never let a save
        // clobber the real secrets with it.
        return !name.hasPrefix(".env")
    }

    var body: some View {
        content
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .toolbar {
                if isEditable {
                    ToolbarItem(placement: .topBarTrailing) {
                        if saving {
                            ProgressView()
                        } else if editing {
                            Button("Save") { Task { await save() } }
                                .fontWeight(.semibold)
                                .disabled(!isDirty)
                        } else {
                            Button("Edit") { editing = true }
                        }
                    }
                }
            }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loadError {
            ContentUnavailableView {
                Label("Couldn’t open file", systemImage: "exclamationmark.triangle")
            } description: { Text(loadError) } actions: {
                Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
            }
        } else if let loaded, loaded.isImage, let image = decodedImage(loaded.dataUrl) {
            ScrollView([.horizontal, .vertical]) {
                image.resizable().scaledToFit().padding()
            }
        } else if let loaded, loaded.kind == "text" {
            editor(loaded)
        } else {
            ContentUnavailableView("Can’t preview this file",
                                   systemImage: "doc.questionmark",
                                   description: Text(loaded?.error ?? "Unsupported file type."))
        }
    }

    @ViewBuilder private func editor(_ loaded: FileContent) -> some View {
        VStack(spacing: 0) {
            if name.hasPrefix(".env") {
                banner("Contents redacted — .env files aren’t editable here.",
                       systemImage: "lock.fill")
            } else if !editing {
                EmptyView()
            }
            TextEditor(text: $text)
                .font(.system(.footnote, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .background(Color(.systemBackground))
                .disabled(!editing || !isEditable)
                .overlay(alignment: .bottomTrailing) {
                    if let size = loaded.size {
                        Text("\(size) bytes")
                            .font(.caption2).foregroundStyle(.tertiary)
                            .padding(6)
                    }
                }
        }
    }

    private func banner(_ message: String, systemImage: String) -> some View {
        Label(message, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(.bar)
    }

    private func load() async {
        guard let client = app.client else { return }
        loading = true
        do {
            let file = try await client.readFile(path: path)
            loaded = file
            if file.kind == "text" {
                text = file.content ?? ""
                original = text
            }
            loadError = file.ok ? nil : (file.error ?? "Couldn’t read file.")
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    private func save() async {
        guard let client = app.client, isDirty else { return }
        saving = true
        defer { saving = false }
        do {
            try await client.writeFile(path: path, content: text)
            original = text
            editing = false
            app.showToast("Saved \(name)", systemImage: "checkmark.circle.fill")
        } catch {
            app.showToast(error.localizedDescription,
                          systemImage: "exclamationmark.triangle.fill", style: .error)
        }
    }

    private func decodedImage(_ dataUrl: String?) -> Image? {
        guard let dataUrl,
              let comma = dataUrl.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])),
              let ui = UIImage(data: data) else { return nil }
        return Image(uiImage: ui)
    }
}
