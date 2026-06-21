import SwiftUI

/// Full-screen view of a single Canvas artifact: a live, interactive preview
/// with a refine composer at the bottom and share/copy/delete in the toolbar.
/// Refining re-generates the document in place, keeping the artifact's identity.
struct ArtifactDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var current: CanvasArtifact
    let familiarId: String

    @State private var refinePrompt = ""
    @State private var showCode = false
    @State private var refineTask: Task<Void, Never>?
    @FocusState private var refineFocused: Bool

    init(artifact: CanvasArtifact, familiarId: String) {
        _current = State(initialValue: artifact)
        self.familiarId = familiarId
    }

    var body: some View {
        ZStack {
            if showCode { codeView } else { previewView }
            if app.isGeneratingCanvas { refiningOverlay }
        }
        .navigationTitle(current.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .safeAreaInset(edge: .bottom) { refineBar }
        .onDisappear { refineTask?.cancel() }
    }

    // MARK: - Preview / code

    private var previewView: some View {
        ArtifactWebView(artifact: current,
                        serverBaseURL: app.connection?.baseURL,
                        interactive: true)
            .background(Color(.systemBackground))
            .ignoresSafeArea(edges: .horizontal)
    }

    private var codeView: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(current.code)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - Refining overlay

    private var refiningOverlay: some View {
        VStack(spacing: 12) {
            ProgressView().controlSize(.large)
            Text("Refining…").font(.subheadline.weight(.semibold))
            Button(role: .destructive) { refineTask?.cancel() } label: {
                Text("Cancel")
            }
            .buttonStyle(.bordered)
        }
        .padding(28)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(radius: 20)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Toggle(isOn: $showCode) {
                    Label("View code", systemImage: "chevron.left.forwardslash.chevron.right")
                }
                Button { UIPasteboard.general.string = current.code } label: {
                    Label("Copy code", systemImage: "doc.on.doc")
                }
                ShareLink(item: current.code) {
                    Label("Share code", systemImage: "square.and.arrow.up")
                }
                Divider()
                Button(role: .destructive) { delete() } label: {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }

    // MARK: - Refine bar

    private var refineBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "wand.and.stars")
                .foregroundStyle(.secondary)
            TextField("Describe a change…", text: $refinePrompt, axis: .vertical)
                .lineLimit(1...3)
                .focused($refineFocused)
                .disabled(app.isGeneratingCanvas)
            Button {
                refine()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(canRefine ? Color.accentColor : Color.secondary)
            }
            .buttonStyle(.plain)
            .disabled(!canRefine)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.bar)
    }

    // MARK: - Derived + actions

    private var canRefine: Bool {
        !app.isGeneratingCanvas
            && !familiarId.isEmpty
            && !refinePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func refine() {
        let ask = refinePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ask.isEmpty, !familiarId.isEmpty, !app.isGeneratingCanvas else { return }
        refineFocused = false
        refineTask?.cancel()
        refineTask = Task {
            if let updated = await app.refineArtifact(current, changeRequest: ask, familiarId: familiarId) {
                current = updated
                refinePrompt = ""
                app.showToast("Updated", systemImage: "checkmark.circle.fill", style: .success)
            } else if let error = app.canvasError {
                app.showToast(error, systemImage: "exclamationmark.triangle.fill", style: .warning)
            }
        }
    }

    private func delete() {
        Task {
            await app.deleteArtifact(current)
            app.showToast("Deleted", systemImage: "trash", style: .info)
            dismiss()
        }
    }
}
