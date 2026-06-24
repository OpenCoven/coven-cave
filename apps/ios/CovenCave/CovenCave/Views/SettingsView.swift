import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.desktop.rawValue
    @State private var editingHost: String = ""
    @State private var showDisconnectConfirm = false
    @State private var exportArchive: ExportArchive?
    @State private var exportFailed = false

    /// Marketing version + build, e.g. "1.2.0 (34)", read from the bundle.
    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        do {
                            exportArchive = ExportArchive(url: try app.exportAllThreadsZip())
                        } catch {
                            exportFailed = true
                        }
                    } label: {
                        Label("Export all chats", systemImage: "square.and.arrow.up.on.square")
                            .foregroundStyle(.primary)
                    }
                    .disabled(app.threads.isEmpty)
                } header: {
                    Text("Chats")
                } footer: {
                    Text("Save every conversation as Markdown files in a single .zip.")
                }

                Section {
                    Picker(selection: $appearanceRaw) {
                        ForEach(AppearanceMode.allCases) { mode in
                            Label(mode.label, systemImage: mode.icon).tag(mode.rawValue)
                        }
                    } label: {
                        Label("Appearance", systemImage: "circle.lefthalf.filled")
                    }
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("“Match desktop” follows your Cave desktop's light/dark mode. Light or Dark sets it just on this phone.")
                }

                Section("Desktop") {
                    LabeledContent("Address") {
                        Text(app.connection?.host ?? "—")
                            .font(.callout.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("Status") { statusBadge }
                    Button("Re-check connection") {
                        Task { await app.refreshConnection() }
                    }
                }

                Section("Change host") {
                    TextField("my-mac.tailnet.ts.net", text: $editingHost)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button("Save and Reconnect") {
                        Task { await app.configure(host: editingHost) }
                    }
                    .disabled(editingHost.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                Section {
                    Button("Disconnect", role: .destructive) {
                        showDisconnectConfirm = true
                    }
                } footer: {
                    Text("Connection is trusted via your Tailscale network — there is no token or password to manage.")
                }

                Section("About") {
                    LabeledContent("Version") {
                        Text(appVersion)
                            .font(.callout.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { editingHost = app.connection?.host ?? "" }
            .confirmationDialog("Disconnect from your desktop?",
                                isPresented: $showDisconnectConfirm,
                                titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { app.disconnect() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You'll need to re-enter your desktop address to reconnect.")
            }
            .sheet(item: $exportArchive) { archive in
                ActivityView(items: [archive.url])
            }
            .alert("Couldn't export chats", isPresented: $exportFailed) {
                Button("OK", role: .cancel) {}
            }
        }
    }

    @ViewBuilder private var statusBadge: some View {
        switch app.connectionState {
        case .connected:
            Label("Connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case .checking:
            Label("Checking…", systemImage: "clock").foregroundStyle(.secondary)
        case .unreachable:
            Label("Unreachable", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        case .unconfigured:
            Label("Not set up", systemImage: "circle").foregroundStyle(.secondary)
        }
    }
}
