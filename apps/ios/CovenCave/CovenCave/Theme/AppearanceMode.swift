import SwiftUI

/// How the iOS app picks its light/dark appearance. By default it mirrors the
/// Cave desktop's published mode; the user can override it to a fixed Light or
/// Dark so the phone stands alone (e.g. light outdoors while the desktop is
/// dark). Persisted in UserDefaults via `@AppStorage(AppearanceMode.storageKey)`.
enum AppearanceMode: String, CaseIterable, Identifiable {
    case desktop, light, dark

    static let storageKey = "cave.appearance"
    var id: String { rawValue }

    var label: String {
        switch self {
        case .desktop: return "Match desktop"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var icon: String {
        switch self {
        case .desktop: return "desktopcomputer"
        case .light: return "sun.max"
        case .dark: return "moon"
        }
    }

    /// The effective chrome + color scheme for this mode. `.desktop` passes the
    /// published palette through untouched; a fixed mode swaps to the built-in
    /// (system-semantic) palette so every adaptive colour follows the forced
    /// scheme with no desktop-palette mismatch.
    func resolve(desktop: ChromePalette) -> (chrome: ChromePalette, scheme: ColorScheme) {
        switch self {
        case .desktop:
            return (desktop, desktop.colorScheme)
        case .light:
            var c = ChromePalette.fallback; c.colorScheme = .light
            return (c, .light)
        case .dark:
            var c = ChromePalette.fallback; c.colorScheme = .dark
            return (c, .dark)
        }
    }
}
