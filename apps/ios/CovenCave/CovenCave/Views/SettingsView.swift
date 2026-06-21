import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var editingHost: String = ""
    @State private var showDeveloper = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        showDeveloper = true
                    } label: {
                        Label("Developer", systemImage: "chevron.left.forwardslash.chevron.right")
                            .foregroundStyle(.primary)
                    }
                } header: {
                    Text("Tools")
                } footer: {
                    Text("Code browser, terminal, and GitHub.")
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
                    Button("Save & reconnect") {
                        Task {
                            await app.configure(host: editingHost)
                            dismiss()
                        }
                    }
                    .disabled(editingHost.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                Section {
                    Button("Disconnect", role: .destructive) {
                        app.disconnect()
                        dismiss()
                    }
                } footer: {
                    Text("Connection is trusted via your Tailscale network — there is no token or password to manage.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { editingHost = app.connection?.host ?? "" }
            // Developer (code/terminal/GitHub) was demoted from a tab; present it
            // as a full-height sheet so its sub-views' own navigation stacks
            // render cleanly. Wrapping it in another NavigationStack (e.g. for a
            // push) would double-nest the nav bars; the sheet's grabber handles
            // dismissal instead.
            .sheet(isPresented: $showDeveloper) {
                DeveloperView()
                    .presentationDragIndicator(.visible)
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
