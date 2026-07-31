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
        // Prompt automatically once per genuine lock presentation while the
        // scene is active. `AppLock.autoPromptOnActive()` de-duplicates
        // against the `.inactive -> .active` bounce a cancelled/failed
        // LocalAuthentication sheet itself causes — that bounce re-runs this
        // `.task` but must not trigger a second automatic prompt; the retry
        // button above remains the only retry until a new genuine lock
        // cycle begins. `AppLock.unlock()`'s own in-flight guard additionally
        // prevents this racing a manual tap on the button into a stacked
        // prompt.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await appLock.autoPromptOnActive()
        }
    }
}

/// Opaque, animation-free shield rendered ABOVE whatever content is
/// currently mounted while `AppLock.isPrivacyShielded` is `true` (raised on
/// `.inactive`/`.background`, cleared on `.active`). Unlike `LockScreenView`,
/// this never replaces the view hierarchy — mounted content (and its
/// navigation/scroll state) keeps living underneath — it only needs to keep
/// app-switcher and Control Center snapshots from exposing anything. No
/// translucency and no animated appearance/disappearance: either could leak
/// a glimpse of content during the transition.
struct PrivacyShieldView: View {
    @Environment(\.chrome) private var chrome

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
            chrome.bgBase
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .transition(.identity)
    }
}
