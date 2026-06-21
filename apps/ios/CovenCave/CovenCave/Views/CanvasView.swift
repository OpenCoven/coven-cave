import SwiftUI

/// The Canvas tab — generate self-contained UIs from a prompt and browse them
/// as a live gallery. A pinned composer (prompt + familiar + quick-starts) sits
/// above an adaptive grid of artifact cards, each a live preview. Tap a card to
/// open it full-screen, where it can be refined, shared, or deleted.
struct CanvasView: View {
    @Environment(AppModel.self) private var app

    @State private var prompt = ""
    @State private var selectedFamiliarId: String?
    @State private var genTask: Task<Void, Never>?
    @State private var detail: CanvasArtifact?
    @FocusState private var promptFocused: Bool

    private let columns = [GridItem(.adaptive(minimum: 158), spacing: 12)]

    /// One-tap starter prompts shown under the composer.
    private let starters: [(label: String, symbol: String, prompt: String)] = [
        ("Pricing page", "tag", "A modern SaaS pricing page with three tiers and a highlighted plan"),
        ("To-do app", "checklist", "An interactive to-do list app where I can add, check off, and delete tasks"),
        ("Sign-in", "person.crop.circle", "A polished centered sign-in card with email, password, and a submit button"),
        ("Dashboard", "square.grid.2x2", "An analytics dashboard with stat cards and a simple bar chart"),
        ("Hero", "sparkles", "An animated landing-page hero with a gradient background and a call-to-action"),
    ]

    var body: some View {
        NavigationStack {
            Group {
                if app.client == nil {
                    notConnected
                } else if !app.canvasLoaded && app.canvasArtifacts.isEmpty {
                    ProgressView().controlSize(.large)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    gallery
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { if !app.canvasLoaded { await app.loadCanvas() } }
            .onAppear { if selectedFamiliarId == nil { selectedFamiliarId = app.familiars.first?.id } }
            .navigationDestination(item: $detail) { artifact in
                ArtifactDetailView(artifact: artifact, familiarId: generationFamiliarId)
            }
        }
    }

    // MARK: - Gallery

    private var gallery: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if app.isGeneratingCanvas { generatingCard }
                if app.canvasArtifacts.isEmpty && !app.isGeneratingCanvas {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(app.canvasArtifacts) { artifact in
                            artifactCard(artifact)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await app.loadCanvas() }
        .safeAreaInset(edge: .top, spacing: 0) { header }
    }

    // MARK: - Header + composer

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Canvas")
                    .font(.largeTitle.weight(.bold))
                Spacer()
                if !app.canvasArtifacts.isEmpty {
                    Text("^[\(app.canvasArtifacts.count) artifact](inflect: true)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            composer
            starterBar
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(.bar)
    }

    private var composer: some View {
        VStack(spacing: 10) {
            TextField("Describe a UI to generate…", text: $prompt, axis: .vertical)
                .lineLimit(1...4)
                .focused($promptFocused)
                .submitLabel(.return)
                .font(.body)
            HStack(spacing: 10) {
                familiarPicker
                Spacer(minLength: 8)
                generateButton
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(promptFocused ? Color.accentColor.opacity(0.5) : .clear, lineWidth: 1)
        )
    }

    private var familiarPicker: some View {
        Menu {
            ForEach(app.familiars) { familiar in
                Button {
                    selectedFamiliarId = familiar.id
                } label: {
                    Label(familiar.displayName,
                          systemImage: selectedFamiliarId == familiar.id ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 6) {
                if let familiar = currentFamiliar {
                    AvatarView(familiar: familiar,
                               url: app.client?.avatarURL(for: familiar), size: 22)
                    Text(familiar.displayName)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                } else {
                    Image(systemName: "wand.and.stars")
                    Text("Familiar").font(.subheadline.weight(.medium))
                }
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
            .padding(.vertical, 5).padding(.horizontal, 9)
            .background(Color(.tertiarySystemBackground), in: Capsule())
        }
        .disabled(app.familiars.isEmpty || app.isGeneratingCanvas)
    }

    private var generateButton: some View {
        Button {
            generate(prompt)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                Text("Generate").fontWeight(.semibold)
            }
            .font(.subheadline)
            .padding(.vertical, 8).padding(.horizontal, 14)
            .background(canGenerate ? Color.accentColor : Color.gray.opacity(0.3),
                        in: Capsule())
            .foregroundStyle(canGenerate ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
        .disabled(!canGenerate)
    }

    private var starterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(starters, id: \.label) { starter in
                    Button {
                        prompt = starter.prompt
                        generate(starter.prompt)
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: starter.symbol).font(.caption2)
                            Text(starter.label).font(.subheadline.weight(.medium))
                        }
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Color(.secondarySystemBackground), in: Capsule())
                        .foregroundStyle(.primary)
                    }
                    .buttonStyle(.plain)
                    .disabled(app.isGeneratingCanvas)
                }
            }
            .padding(.vertical, 2)
        }
        // A horizontal ScrollView reports ≈zero ideal height and collapses inside
        // a VStack without a fixed height.
        .frame(height: 38)
    }

    // MARK: - Generating card

    private var generatingCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Sketching your UI…")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button(role: .destructive) {
                    genTask?.cancel()
                } label: {
                    Text("Cancel").font(.subheadline.weight(.medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
            }
            if !app.canvasStreamText.isEmpty {
                Text(streamTail)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .animation(.default, value: app.canvasStreamText)
            }
        }
        .padding(14)
        .background(Color.accentColor.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(0.25), lineWidth: 1)
        )
        .padding(.horizontal, 16)
    }

    /// The trailing slice of the streaming reply — the part most likely showing
    /// live progress, kept short so it doesn't dominate the card.
    private var streamTail: String {
        let text = app.canvasStreamText
        return text.count > 220 ? "…" + text.suffix(220) : text
    }

    // MARK: - Artifact card

    private func artifactCard(_ artifact: CanvasArtifact) -> some View {
        Button {
            promptFocused = false
            detail = artifact
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                ArtifactWebView(artifact: artifact,
                                serverBaseURL: app.connection?.baseURL,
                                interactive: false)
                    .frame(height: 150)
                    .frame(maxWidth: .infinity)
                    .background(Color(.systemBackground))
                    .clipped()
                    .overlay(alignment: .topTrailing) { kindBadge(artifact.kind) }
                    .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 3) {
                    Text(artifact.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let date = artifact.updatedDate {
                        Text(date, format: .relative(presentation: .numeric))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(10)
            }
            .background(Color(.secondarySystemBackground),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu { cardMenu(artifact) }
    }

    private func kindBadge(_ kind: ArtifactKind) -> some View {
        HStack(spacing: 3) {
            Image(systemName: kind.symbol).font(.system(size: 8, weight: .bold))
            Text(kind.label).font(.system(size: 9, weight: .bold))
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(6)
    }

    @ViewBuilder private func cardMenu(_ artifact: CanvasArtifact) -> some View {
        Button { detail = artifact } label: {
            Label("Open", systemImage: "arrow.up.left.and.arrow.down.right")
        }
        Button { UIPasteboard.general.string = artifact.code } label: {
            Label("Copy code", systemImage: "doc.on.doc")
        }
        ShareLink(item: artifact.code) { Label("Share code", systemImage: "square.and.arrow.up") }
        Divider()
        Button(role: .destructive) {
            Task {
                await app.deleteArtifact(artifact)
                app.showToast("Deleted", systemImage: "trash", style: .info)
            }
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    // MARK: - Empty / disconnected

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Nothing on the canvas yet", systemImage: "wand.and.stars")
        } description: {
            Text("Describe a UI above — a pricing page, a to-do app, a dashboard — and a familiar will sketch it live.")
        }
        .frame(maxWidth: .infinity, minHeight: 320)
    }

    private var notConnected: some View {
        ContentUnavailableView {
            Label("Not connected", systemImage: "wifi.slash")
        } description: {
            Text("Connect to your desktop to generate and browse canvas artifacts.")
        }
    }

    // MARK: - Derived + actions

    private var currentFamiliar: Familiar? {
        guard let id = selectedFamiliarId ?? app.familiars.first?.id else { return nil }
        return app.familiar(id)
    }

    private var generationFamiliarId: String {
        selectedFamiliarId ?? app.familiars.first?.id ?? ""
    }

    private var canGenerate: Bool {
        !app.isGeneratingCanvas
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !app.familiars.isEmpty
    }

    private func generate(_ text: String) {
        let toSend = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !toSend.isEmpty, !app.isGeneratingCanvas else { return }
        guard let familiarId = selectedFamiliarId ?? app.familiars.first?.id else {
            app.showToast("No familiar available", systemImage: "wand.and.stars", style: .warning)
            return
        }
        promptFocused = false
        genTask?.cancel()
        genTask = Task {
            if let artifact = await app.generateArtifact(prompt: toSend, familiarId: familiarId) {
                prompt = ""
                detail = artifact
            } else if let error = app.canvasError {
                app.showToast(error, systemImage: "exclamationmark.triangle.fill", style: .warning)
            }
        }
    }
}
