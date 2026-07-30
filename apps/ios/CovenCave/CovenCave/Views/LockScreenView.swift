import SwiftUI

/// Full-screen replacement shown at the app root whenever `AppLock.isLocked`
/// is `true`. Deliberately never a translucent overlay: a cold-launch or
/// re-lock must guarantee zero app content is visible before authentication
/// succeeds. `CovenCaveApp` swaps this in for the *entire* window content
/// rather than layering it on top.
struct LockScreenView: View {
    var appLock: AppLock
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                RadialGradient(
                    colors: [chrome.accent.opacity(0.18), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: 56
                )
                .frame(width: 112, height: 112)

                Image(systemName: appLock.biometricSystemImage)
                    .font(.system(size: 34, weight: .medium))
                    .foregroundStyle(chrome.accent)
            }
            .accessibilityHidden(true)

            VStack(spacing: 8) {
                Text("Coven Cave is locked")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                Text("Use \(appLock.biometricLabel) to continue.")
                    .font(.subheadline)
                    .foregroundStyle(chrome.textSecondary)
            }
            .multilineTextAlignment(.center)

            Button {
                Task { await appLock.unlock() }
            } label: {
                Label("Unlock", systemImage: appLock.biometricSystemImage)
                    .font(.headline)
                    .frame(maxWidth: 260)
            }
            .buttonStyle(.borderedProminent)
            .tint(chrome.accent)
            .disabled(appLock.isAuthenticating)
            .accessibilityHint("Prompts \(appLock.biometricLabel) or your device passcode.")

            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(chrome.bgBase.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Coven Cave is locked")
        // Prompt automatically once the scene is genuinely active. Re-runs
        // only when scenePhase itself changes (not on every re-render), and
        // `AppLock.unlock()`'s own in-flight guard prevents this racing a
        // manual tap on the button into a second stacked prompt.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await appLock.unlock()
        }
    }
}
