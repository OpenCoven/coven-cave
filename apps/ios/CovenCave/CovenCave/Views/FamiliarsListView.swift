import SwiftUI
import PhotosUI
import UIKit

enum FamiliarsListCopy {
    static let cachedAccessBanner = "Showing cached familiar access"

    static func emptyState(for context: ProjectContext?) -> (title: String, message: String) {
        switch context {
        case .project(let project):
            return (
                "No familiars have access",
                "No familiars have access to \(project.name) yet."
            )
        case .unassigned:
            return ("No recovery familiars", ProjectContextCopy.unassignedRecovery)
        case nil:
            return ("Choose a project", "Choose a project in Chats to see its familiar roster.")
        }
    }
}

@MainActor
struct FamiliarsListPresentation {
    enum Mode: Equatable {
        case loading
        case firstLoadError(String)
        case empty(title: String, message: String)
        case list
    }

    let visibleFamiliars: [Familiar]
    let showsCachedAccessBanner: Bool
    let mode: Mode

    init(app: AppModel) {
        visibleFamiliars = app.projectFamiliars
        showsCachedAccessBanner = app.projectMembershipLoaded && app.familiarsError != nil

        guard app.projectMembershipLoaded else {
            if let error = app.familiarsError {
                mode = .firstLoadError(error)
            } else {
                mode = .loading
            }
            return
        }

        if visibleFamiliars.isEmpty {
            let copy = FamiliarsListCopy.emptyState(for: app.projectContext)
            mode = .empty(title: copy.title, message: copy.message)
        } else {
            mode = .list
        }
    }
}

@MainActor
struct FamiliarDetailStatsModel {
    let chats: String
    let activity: String
    let tasks: String
    let memory: String

    static func make(
        app: AppModel,
        familiar: Familiar,
        context: ProjectContext?
    ) -> FamiliarDetailStatsModel {
        let chatCount = context.map { app.threadCount(for: familiar.id, in: $0) } ?? 0
        let assignedTasks = context.map { scopedContext in
            app.tasks.filter {
                scopedContext.matches(task: $0, registeredProjects: app.projects)
                    && $0.familiarId == familiar.id
                    && $0.status.isActive
            }
        } ?? []
        let taskValue = app.tasksError == nil
            ? "\(assignedTasks.count)"
            : app.tasks.isEmpty ? "Unknown" : "\(assignedTasks.count) cached"

        return FamiliarDetailStatsModel(
            chats: "\(chatCount)",
            activity: activityValue(for: context.flatMap { app.lastActivity(for: familiar.id, in: $0) }),
            tasks: taskValue,
            memory: familiar.memoryFreshness ?? "Unknown"
        )
    }

    static func activityValue(for lastActivity: Date?) -> String {
        guard let lastActivity else { return "No activity yet" }
        return lastActivity.formatted(date: .abbreviated, time: .shortened)
    }
}

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
        let presentation = FamiliarsListPresentation(app: app)
        NavigationStack {
            Group {
                switch presentation.mode {
                case .loading:
                    ProgressView("Loading familiars…")
                        .controlSize(.large)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .firstLoadError(let error):
                    ContentUnavailableView {
                        Label("Couldn’t load familiars", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await app.loadFamiliars() } }
                            .buttonStyle(.borderedProminent)
                    }
                case .empty(let title, let message):
                    ContentUnavailableView {
                        Label(title, systemImage: app.projectContext == .unassigned ? "tray.full" : "cat")
                    } description: {
                        Text(message)
                    }
                case .list:
                    List(presentation.visibleFamiliars) { familiar in
                        NavigationLink {
                            // The roster opens the unified hub (cave-9rwd.2).
                            // The Chats hand-off is unchanged: the hub's Chat
                            // action runs the exact same closure the detail
                            // page's button used to.
                            FamiliarHubView(familiar: familiar) {
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
            .safeAreaInset(edge: .top, spacing: 0) {
                if presentation.showsCachedAccessBanner {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle")
                        Text(FamiliarsListCopy.cachedAccessBanner)
                            .font(.footnote)
                        Spacer()
                        Button("Retry") { Task { await app.loadFamiliars() } }
                            .font(.footnote.weight(.semibold))
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .foregroundStyle(chrome.textSecondary)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(chrome.bgRaised)
                }
            }
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

/// The Familiar hub's **Profile** tab body (`cave-9rwd.2` shell).
///
/// This was the roster's standalone detail page until the hub landed. It kept
/// its identity, defaults and access surfaces and lost the parts the hub now
/// owns — the avatar hero, the navigation title, the scroll container and the
/// primary Chat action — so nothing is drawn twice.
///
/// It is still driven by the paths that OWN these mutations (the chat model
/// inventory, `FamiliarPermissionsSheet`) rather than by the dashboard read.
/// `cave-9rwd.4` replaces it with the comprehensive dashboard-driven profile;
/// rendering nothing here in the meantime would be a regression from what the
/// roster used to open.
struct FamiliarDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let familiar: Familiar

    @State private var modelState: ChatModelState?
    @State private var modelOptions: [ChatModelOption] = []
    @State private var modelAllowsRuntimeDefault = false
    @State private var modelProvenance: String?
    @State private var modelBindingScope: String?
    @State private var modelPresentationScope = ChatModelPresentationScope()
    @State private var showModelPicker = false
    @State private var showPermissions = false
    @State private var changingModel = false
    @State private var modelMutationQueue = ChatModelMutationQueue()
    @State private var showAvatarActions = false
    @State private var showAvatarPhotosPicker = false
    @State private var showAvatarCamera = false
    @State private var avatarPhotoItem: PhotosPickerItem?
    @State private var changingAvatar = false

    private var scopedContext: ProjectContext? {
        app.projectContext
    }

    private var statsModel: FamiliarDetailStatsModel {
        FamiliarDetailStatsModel.make(app: app, familiar: familiar, context: scopedContext)
    }

    private var modelLoadTarget: ChatModelRequestTarget {
        let harness = (app.familiar(familiar.id)?.harness ?? familiar.harness)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return ChatModelRequestTarget(
            familiarId: familiar.id,
            sessionId: nil,
            runtimeIdentity: harness.flatMap { $0.isEmpty ? nil : "harness:\($0)" }
        )
    }

    private var modelRequestTarget: ChatModelRequestTarget {
        modelLoadTarget.withBindingScope(modelBindingScope)
    }

    private var modelPresentationIsCurrent: Bool {
        modelPresentationScope.isCurrent(for: modelRequestTarget)
    }

    private var presentedModelState: ChatModelState? {
        modelPresentationIsCurrent ? modelState : nil
    }

    private var presentedModelOptions: [ChatModelOption] {
        modelPresentationIsCurrent ? modelOptions : []
    }

    private var presentedModelAllowsRuntimeDefault: Bool {
        // Keep clearing explicit Cave-owned model choices available. The
        // inventory owner describes the initial default, not picker actions.
        modelPresentationIsCurrent && (modelAllowsRuntimeDefault || modelState != nil)
    }

    private var presentedModelProvenance: String? {
        modelPresentationIsCurrent ? modelProvenance : nil
    }

    private var modelLabel: String {
        guard let state = presentedModelState else { return familiar.model ?? "Inherited" }
        if state.effectiveModel.isEmpty { return "Runtime default" }
        return presentedModelOptions.first(where: { $0.id == state.effectiveModel })?.label
            ?? state.effectiveModel.split(separator: "/").last.map(String.init)
            ?? state.effectiveModel
    }

    private var runtimeLabel: String {
        if let runtime = presentedModelState?.runtime, !runtime.isEmpty { return runtime }
        return presentedModelState?.harness ?? familiar.harness ?? "Inherited"
    }

    var body: some View {
        VStack(spacing: 22) {
            stats
            identitySection
            defaultsSection
            accessSection
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: modelLoadTarget) {
            if !app.tasksLoaded { await app.loadTasks() }
            await loadModel()
        }
        .sheet(isPresented: $showModelPicker) {
            ModelPickerSheet(
                options: presentedModelOptions,
                current: presentedModelState?.effectiveModel ?? familiar.model ?? "",
                allowsRuntimeDefault: presentedModelAllowsRuntimeDefault,
                provenance: presentedModelProvenance,
                onSelect: { model in Task { await chooseModel(model) } },
                application: .familiarDefault)
        }
        .sheet(isPresented: $showPermissions) {
            FamiliarPermissionsSheet(familiar: familiar)
        }
        .photosPicker(
            isPresented: $showAvatarPhotosPicker,
            selection: $avatarPhotoItem,
            matching: .images
        )
        .onChange(of: avatarPhotoItem) { _, item in
            guard let item else { return }
            Task { await loadAvatar(item) }
        }
        .fullScreenCover(isPresented: $showAvatarCamera) {
            CameraPicker { image in
                Task { await updateAvatar(image) }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog(
            "Familiar avatar",
            isPresented: $showAvatarActions,
            titleVisibility: .visible
        ) {
            Button("Choose photo") { showAvatarPhotosPicker = true }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take photo") { showAvatarCamera = true }
            }
            if currentFamiliar.avatarUrl != nil {
                Button("Remove avatar", role: .destructive) {
                    Task { await removeAvatar() }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Choose how \(familiar.displayName) appears throughout Coven Cave.")
        }
    }

    // The avatar/name/presence hero that used to sit here is gone: the hub's
    // persistent identity header carries it. Avatar editing remains in the
    // Profile identity group below, without drawing the hero twice.

    private var currentFamiliar: Familiar {
        app.familiar(familiar.id) ?? familiar
    }

    private var stats: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            statCard("Chats", value: statsModel.chats, icon: "bubble.left")
            statCard("Activity", value: statsModel.activity, icon: "clock")
            statCard("Tasks", value: statsModel.tasks, icon: "checkmark.square")
            statCard("Memory", value: statsModel.memory, icon: "brain")
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
            Button {
                showAvatarActions = true
            } label: {
                HStack(spacing: 12) {
                    AvatarView(
                        familiar: currentFamiliar,
                        url: app.client?.avatarURL(for: currentFamiliar),
                        size: 40,
                        showStatus: false
                    )
                    Text("Avatar")
                        .foregroundStyle(.primary)
                    Spacer()
                    if changingAvatar {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Edit")
                            .foregroundStyle(.secondary)
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(changingAvatar || app.client == nil)
            .accessibilityLabel("Edit \(familiar.displayName)’s avatar")
            .accessibilityHint("Choose a photo, take a photo, or remove the current avatar.")
            Divider()
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
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(modelLabel)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Text(ChatModelInventoryProvenancePresentation.compactLabel(for: presentedModelProvenance))
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(
                !modelPresentationIsCurrent
                    || (presentedModelOptions.isEmpty && !presentedModelAllowsRuntimeDefault)
                    || changingModel
            )
            .accessibilityLabel(
                "Model: \(modelLabel). \(ChatModelInventoryProvenancePresentation.label(for: presentedModelProvenance))"
            )
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
        let target = modelRequestTarget
        if modelPresentationScope.beginLoading(for: target) {
            modelState = nil
            modelOptions = []
            modelAllowsRuntimeDefault = false
            modelProvenance = nil
        }
        guard let client = app.client else {
            if modelPresentationScope.canApplyResponse(
                for: target,
                currentTarget: modelRequestTarget
            ) {
                modelProvenance = "unavailable"
            }
            return
        }
        do {
            let response = try await client.chatModelState(familiarId: familiar.id, sessionId: nil)
            guard let responseTarget = modelPresentationScope.rekeyForResponse(
                for: target,
                currentTarget: modelRequestTarget,
                bindingScope: response.presentationBindingScope
            ) else { return }
            modelBindingScope = response.presentationBindingScope
            guard modelRequestTarget == responseTarget else { return }
            modelState = response.state
            modelOptions = response.options ?? []
            modelAllowsRuntimeDefault = response.inventory?.allowsRuntimeDefault ?? false
            modelProvenance = response.inventory?.provenance ?? "unavailable"
        } catch {
            guard modelPresentationScope.canApplyResponse(
                for: target,
                currentTarget: modelRequestTarget
            ) else { return }
            if modelState == nil {
                modelOptions = []
                modelAllowsRuntimeDefault = false
                modelProvenance = "unavailable"
            }
        }
    }

    private func chooseModel(_ model: String?) async {
        guard let client = app.client else { return }
        changingModel = true
        let target = modelRequestTarget
        let mutation = modelMutationQueue.enqueue {
            defer { self.changingModel = false }
            do {
                let response = try await client.setChatModel(
                    familiarId: familiar.id,
                    sessionId: nil,
                    model: model,
                    scope: "familiar-default")
                guard self.modelPresentationScope.canApplyResponse(
                    for: target,
                    currentTarget: self.modelRequestTarget
                ) else { return }
                self.modelState = response.state
                self.modelOptions = response.options ?? self.modelOptions
                self.modelAllowsRuntimeDefault =
                    response.inventory?.allowsRuntimeDefault ?? self.modelAllowsRuntimeDefault
                self.modelProvenance = response.inventory?.provenance ?? self.modelProvenance
                self.app.showToast("Default model updated", systemImage: "cpu")
            } catch {
                self.app.showToast("Couldn’t update the model",
                                  systemImage: "exclamationmark.triangle.fill",
                                  style: .error)
            }
        }
        await mutation.value
    }

    @MainActor
    private func loadAvatar(_ item: PhotosPickerItem) async {
        defer { avatarPhotoItem = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data) else {
                app.showToast(
                    "Couldn’t read that photo",
                    systemImage: "exclamationmark.triangle.fill",
                    style: .error
                )
                return
            }
            await updateAvatar(image)
        } catch {
            app.showToast(
                "Couldn’t read that photo",
                systemImage: "exclamationmark.triangle.fill",
                style: .error
            )
        }
    }

    @MainActor
    private func updateAvatar(_ image: UIImage) async {
        guard let client = app.client else { return }
        let resized = image.resizedForUpload(maxDimension: 1_024)
        guard let data = resized.jpegData(compressionQuality: 0.84) else {
            app.showToast(
                "Couldn’t prepare that photo",
                systemImage: "exclamationmark.triangle.fill",
                style: .error
            )
            return
        }

        changingAvatar = true
        defer { changingAvatar = false }
        do {
            let mutation = try await client.uploadFamiliarAvatar(
                id: familiar.id,
                imageData: data,
                contentType: "image/jpeg"
            )
            app.applyFamiliarAvatarMutation(id: familiar.id, avatarUrl: mutation.avatarUrl)
            app.showToast("Avatar updated", systemImage: "person.crop.circle.fill")
            Haptics.success()
        } catch {
            app.showToast(
                "Couldn’t update the avatar",
                systemImage: "exclamationmark.triangle.fill",
                style: .error
            )
        }
    }

    @MainActor
    private func removeAvatar() async {
        guard let client = app.client else { return }
        changingAvatar = true
        defer { changingAvatar = false }
        do {
            let mutation = try await client.deleteFamiliarAvatar(id: familiar.id)
            app.applyFamiliarAvatarMutation(id: familiar.id, avatarUrl: mutation.avatarUrl)
            app.showToast("Avatar removed", systemImage: "person.crop.circle")
            Haptics.tap()
        } catch {
            app.showToast(
                "Couldn’t remove the avatar",
                systemImage: "exclamationmark.triangle.fill",
                style: .error
            )
        }
    }
}
