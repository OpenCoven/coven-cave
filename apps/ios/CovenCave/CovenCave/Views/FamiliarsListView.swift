import SwiftUI

/// The all-familiars roster (design: "Familiars" drawer destination): every
/// summoned familiar with its avatar, role, and live presence. Tapping one
/// dismisses the sheet and routes to that familiar's threads.
struct FamiliarsListView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.dismiss) private var dismiss

    /// Host-supplied: route to the familiar's surface after dismissal.
    var openFamiliar: (Familiar) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if app.familiars.isEmpty {
                    ContentUnavailableView {
                        Label("No familiars", systemImage: "cat")
                    } description: {
                        Text("Familiars summoned on the desktop appear here.")
                    }
                } else {
                    List(app.familiars) { familiar in
                        NavigationLink {
                            FamiliarDetailView(familiar: familiar) {
                                dismiss()
                                openFamiliar(familiar)
                            }
                        } label: {
                            FamiliarRosterRow(familiar: familiar)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(chrome.border.opacity(0.6))
                    }
                    .listStyle(.plain)
                }
            }
            .themedListBackground()
            .navigationTitle("Familiars")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .themedSheetBackground()
    }
}

/// One roster row: 46pt avatar with presence dot, name + role, and a trailing
/// presence label matching the design's active/idle treatment.
private struct FamiliarRosterRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar

    private var isActive: Bool { Presence.isActive(familiar.status) }

    private var presenceLabel: String {
        guard let status = familiar.status?.lowercased(), !status.isEmpty else { return "idle" }
        switch status {
        case "active", "online": return "active"
        case "busy", "running": return "busy"
        default: return status
        }
    }

    var body: some View {
        HStack(spacing: 13) {
            AvatarView(familiar: familiar,
                       url: app.client?.avatarURL(for: familiar),
                       size: 46, showStatus: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(familiar.displayName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
                if let role = familiar.role, !role.isEmpty {
                    Text(role)
                        .font(.system(size: 13.5))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(presenceLabel)
                .font(.caption)
                .foregroundStyle(isActive ? AnyShapeStyle(Color.green) : AnyShapeStyle(.secondary))
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityLabel("\(familiar.displayName), \(presenceLabel)")
        .accessibilityHint(Text("Opens this familiar's details."))
    }
}

struct FamiliarDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar
    let openChat: () -> Void

    @State private var modelState: ChatModelState?
    @State private var modelOptions: [ChatModelOption] = []
    @State private var showModelPicker = false
    @State private var showPermissions = false
    @State private var changingModel = false

    private var assignedTasks: [BoardCard] {
        app.tasks.filter { $0.familiarId == familiar.id && $0.status.isActive }
    }

    private var modelLabel: String {
        guard let state = modelState else { return familiar.model ?? "Inherited" }
        return modelOptions.first(where: { $0.id == state.effectiveModel })?.label
            ?? state.effectiveModel.split(separator: "/").last.map(String.init)
            ?? state.effectiveModel
    }

    private var runtimeLabel: String {
        if let runtime = modelState?.runtime, !runtime.isEmpty { return runtime }
        return modelState?.harness ?? familiar.harness ?? "Inherited"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                hero
                stats
                identitySection
                defaultsSection
                accessSection
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .background(chrome.bgBase)
        .navigationTitle(familiar.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button(action: openChat) {
                Label("Chat with \(familiar.displayName)", systemImage: "bubble.left.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .glassChrome(.bottom)
        }
        .task {
            if !app.tasksLoaded { await app.loadTasks() }
            await loadModel()
        }
        .sheet(isPresented: $showModelPicker) {
            ModelPickerSheet(
                options: modelOptions,
                current: modelState?.effectiveModel ?? familiar.model ?? "",
                onSelect: { model in Task { await chooseModel(model) } },
                application: .familiarDefault)
        }
        .sheet(isPresented: $showPermissions) {
            FamiliarPermissionsSheet(familiar: familiar)
        }
    }

    private var hero: some View {
        VStack(spacing: 12) {
            AvatarView(
                familiar: familiar,
                url: app.client?.avatarURL(for: familiar),
                size: 108,
                showStatus: true)
                .shadow(color: chrome.accent.opacity(0.2), radius: 20, y: 8)
            Text(familiar.displayName)
                .font(.system(size: 34, weight: .semibold, design: .serif))
            HStack(spacing: 7) {
                Circle()
                    .fill(Presence.isActive(familiar.status) ? Color.green : chrome.textSecondary)
                    .frame(width: 7, height: 7)
                Text(familiar.role ?? familiar.status?.capitalized ?? "Familiar")
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
        }
        .padding(.top, 18)
    }

    private var stats: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            statCard("Sessions", value: "\(app.threadCount(for: familiar.id))", icon: "bubble.left")
            statCard(
                "Active",
                value: familiar.activeSessions.map(String.init) ?? "Unknown",
                icon: "bolt.fill"
            )
            statCard("Tasks", value: "\(assignedTasks.count)", icon: "checkmark.square")
            statCard("Memory", value: familiar.memoryFreshness ?? "Unknown", icon: "brain")
        }
    }

    private func statCard(_ title: String, value: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Image(systemName: icon)
                .foregroundStyle(chrome.accent)
            Text(value)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glass(.raised, cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }

    private var identitySection: some View {
        detailGroup {
            Text("Identity")
                .font(.headline)
            detailValue("Role", familiar.role ?? "Not set")
            if let pronouns = familiar.pronouns, !pronouns.isEmpty {
                detailValue("Pronouns", pronouns)
            }
            if let description = familiar.description, !description.isEmpty {
                Divider()
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var defaultsSection: some View {
        detailGroup {
            Text("Defaults")
                .font(.headline)
            detailValue("Runtime", runtimeLabel)
            Divider()
            Button {
                showModelPicker = true
            } label: {
                HStack {
                    Text("Model")
                        .foregroundStyle(.primary)
                    Spacer()
                    if changingModel {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(modelLabel)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(modelOptions.isEmpty || changingModel)
        }
    }

    private var accessSection: some View {
        detailGroup {
            Text("Access")
                .font(.headline)
            Button {
                showPermissions = true
            } label: {
                HStack {
                    Label("Project and tool permissions", systemImage: "lock.shield")
                        .foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func detailValue(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
        .frame(minHeight: 34)
    }

    private func detailGroup<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(.raised, cornerRadius: 16)
    }

    private func loadModel() async {
        guard let client = app.client else { return }
        do {
            let response = try await client.chatModelState(familiarId: familiar.id, sessionId: nil)
            modelState = response.state
            modelOptions = response.options ?? []
        } catch {
            modelState = nil
            modelOptions = []
        }
    }

    private func chooseModel(_ model: String) async {
        guard let client = app.client else { return }
        changingModel = true
        defer { changingModel = false }
        do {
            let response = try await client.setChatModel(
                familiarId: familiar.id,
                sessionId: nil,
                model: model,
                scope: "familiar-default")
            modelState = response.state
            modelOptions = response.options ?? modelOptions
            app.showToast("Default model updated", systemImage: "cpu")
        } catch {
            app.showToast("Couldn’t update the model",
                          systemImage: "exclamationmark.triangle.fill",
                          style: .error)
        }
    }
}
