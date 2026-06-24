import SwiftUI
import UIKit

// MARK: - Liquid-glass surfaces

/// One reusable, theme-aware glass system so every translucent surface in the app
/// frosts the *same* way and — crucially — picks up the desktop's selected
/// appearance (`@Environment(\.chrome)`) instead of a neutral system blur. The
/// frost is *accent-infused*: a whisper of `chrome.accent` is washed over the
/// palette tint so chrome carries the theme's brand hue (Coven → lavender,
/// Hex → red) rather than reading as plain grey.
///
/// Accessibility is built in, not bolted on:
/// - **Reduce Transparency** → the material is dropped for a solid `chrome`
///   surface, so nothing shows through and text contrast is preserved.
/// - **Increase Contrast** → the accent wash (which lowers contrast) is removed
///   and the hairline border is promoted to a full, wider stroke.
/// - Shadows/glows are suppressed for both, and for **Reduce Motion**.
enum GlassLevel {
    /// Top/bottom bars and the tab bar — the app's outermost chrome.
    case chrome
    /// Pill controls: the search field, compose button, small action chips.
    case control
    /// Card / row containers that should read as a step above the canvas.
    case raised
    /// Floating overlays: popovers, menus, toasts, sheet surrounds.
    case elevated

    /// The blur weight. Heavier for outer chrome and overlays; lighter for inline
    /// controls so they don't over-darken the content they sit on.
    var material: Material {
        switch self {
        case .chrome, .elevated: return .regularMaterial
        case .control, .raised: return .thinMaterial
        }
    }

    /// How strongly the palette tint sits over the frost (0–1).
    var tintOpacity: Double {
        switch self {
        case .chrome: return 0.55
        case .control: return 0.5
        case .raised: return 0.45
        case .elevated: return 0.62
        }
    }

    /// The accent wash that infuses the brand hue. Kept low so text stays legible.
    var accentOpacity: Double {
        switch self {
        case .chrome: return 0.12
        case .control: return 0.10
        case .raised: return 0.08
        case .elevated: return 0.14
        }
    }

    var shadow: (radius: CGFloat, y: CGFloat, opacity: Double) {
        switch self {
        case .chrome: return (12, -2, 0.10)
        case .control: return (8, 3, 0.12)
        case .raised: return (6, 2, 0.08)
        case .elevated: return (18, 8, 0.16)
        }
    }
}

extension View {
    /// Frost a surface with the theme-tinted, accessibility-aware glass for `level`,
    /// clipped to `shape` (a Capsule for the search field, a Circle for the compose
    /// button, a RoundedRectangle for cards/menus).
    func glass<S: InsettableShape>(_ level: GlassLevel, in shape: S) -> some View {
        modifier(GlassBackground(level: level, shape: shape))
    }

    /// Convenience for the common rounded-rectangle case.
    func glass(_ level: GlassLevel, cornerRadius: CGFloat = 16) -> some View {
        glass(level, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    /// The frost *only* — material + palette tint + accent wash, no border or shadow.
    /// For surfaces that already supply their own border/shadow (a toast with a
    /// status-tinted ring, a menu with a separator stroke) or for bare inline chips
    /// that shouldn't gain depth. Still degrades to a solid surface under Reduce
    /// Transparency.
    func glassFill<S: InsettableShape>(_ level: GlassLevel, in shape: S) -> some View {
        modifier(GlassBackground(level: level, shape: shape, border: false, shadow: false))
    }

    /// A top or bottom chrome bar (large-title header, floating bottom bar) whose
    /// frost extends under the safe-area inset so it reads as a single sheet of glass.
    func glassChrome(_ edge: Edge.Set) -> some View {
        modifier(GlassChrome(edge: edge))
    }

    /// A contained, full-width frosted bar — the faithful, theme-aware replacement
    /// for `.background(.bar)`: fills its own frame (no safe-area bleed), no boxed
    /// border, just an accent-infused frost with a single hairline divider on the
    /// given `divider` edge (default top, for a bar that sits below content).
    func glassBar(divider: Edge.Set = .top) -> some View {
        modifier(GlassBar(divider: divider))
    }

    /// An accent-coloured halo on a selected/active element (the focused search
    /// field, the compose button, the current tab). Suppressed under Reduce
    /// Transparency / Increase Contrast / Reduce Motion, where a glow either hurts
    /// legibility or is unwanted motion.
    func accentGlow(active: Bool) -> some View {
        modifier(AccentGlow(active: active))
    }
}

/// Builds the layered glass background (material + palette tint + accent wash +
/// hairline border + soft shadow), branching on the accessibility environment.
private struct GlassBackground<S: InsettableShape>: ViewModifier {
    let level: GlassLevel
    let shape: S
    var border: Bool = true
    var shadow: Bool = true

    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.background {
            glassLayers(level: level, shape: shape, chrome: chrome,
                        reduceTransparency: reduceTransparency,
                        increasedContrast: contrast == .increased,
                        reduceMotion: reduceMotion,
                        border: border, shadow: shadow)
        }
    }
}

private struct GlassChrome: ViewModifier {
    let edge: Edge.Set

    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.background {
            glassLayers(level: .chrome, shape: Rectangle(), chrome: chrome,
                        reduceTransparency: reduceTransparency,
                        increasedContrast: contrast == .increased,
                        reduceMotion: reduceMotion)
                .ignoresSafeArea(edges: edge)
        }
    }
}

/// A contained frosted bar: the layered frost (no box border, no shadow) plus one
/// hairline divider, so it reads like the system `.bar` material but themed.
private struct GlassBar: ViewModifier {
    let divider: Edge.Set

    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let increasedContrast = contrast == .increased
        content.background {
            glassLayers(level: .chrome, shape: Rectangle(), chrome: chrome,
                        reduceTransparency: reduceTransparency,
                        increasedContrast: increasedContrast,
                        reduceMotion: reduceMotion,
                        border: false, shadow: false)
                .overlay(alignment: divider == .bottom ? .bottom : .top) {
                    Rectangle()
                        .fill(chrome.border.opacity(increasedContrast ? 1.0 : 0.4))
                        .frame(height: increasedContrast ? 1.0 : 0.5)
                }
        }
    }
}

/// The shared layer stack, parameterised by the already-resolved environment so
/// both `glass()` and `glassChrome()` render identically.
@ViewBuilder
private func glassLayers<S: InsettableShape>(
    level: GlassLevel,
    shape: S,
    chrome: ChromePalette,
    reduceTransparency: Bool,
    increasedContrast: Bool,
    reduceMotion: Bool,
    border: Bool = true,
    shadow: Bool = true
) -> some View {
    let tintColor = level == .elevated ? chrome.bgElevated : chrome.bgRaised
    let borderOpacity = increasedContrast ? 1.0 : 0.4
    let lineWidth: CGFloat = increasedContrast ? 1.5 : 0.6
    let showShadow = shadow && !reduceTransparency && !increasedContrast && !reduceMotion
    let s = level.shadow

    ZStack {
        if reduceTransparency {
            // No see-through: a solid themed surface keeps full contrast.
            shape.fill(tintColor)
            if !increasedContrast {
                shape.fill(chrome.accent.opacity(level.accentOpacity * 0.5))
            }
        } else {
            shape.fill(level.material)
            shape.fill(tintColor.opacity(level.tintOpacity))
            if !increasedContrast {
                shape.fill(chrome.accent.opacity(level.accentOpacity))
            }
        }
        if border {
            shape.strokeBorder(chrome.border.opacity(borderOpacity), lineWidth: lineWidth)
        }
    }
    .compositingGroup()
    .shadow(color: .black.opacity(showShadow ? s.opacity : 0),
            radius: showShadow ? s.radius : 0,
            y: showShadow ? s.y : 0)
}

private struct AccentGlow: ViewModifier {
    let active: Bool

    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var enabled: Bool {
        active && !reduceTransparency && !reduceMotion && contrast != .increased
    }

    func body(content: Content) -> some View {
        content
            .shadow(color: chrome.accent.opacity(enabled ? 0.45 : 0),
                    radius: enabled ? 10 : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: active)
    }
}

// MARK: - Dynamic-Type-aware control sizing

/// A square control (e.g. the circular compose button) whose side grows with the
/// user's Dynamic Type setting, so icons never stay pinned at a fixed point size.
struct ScaledControlFrame: ViewModifier {
    @ScaledMetric private var side: CGFloat

    init(_ base: CGFloat) { _side = ScaledMetric(wrappedValue: base, relativeTo: .title3) }

    func body(content: Content) -> some View {
        content.frame(width: side, height: side)
    }
}

extension View {
    /// Size a square control by `base` points, scaled with Dynamic Type.
    func scaledControlFrame(_ base: CGFloat) -> some View {
        modifier(ScaledControlFrame(base))
    }
}

// MARK: - Frosted system bars (tab + navigation)

extension View {
    /// Paint the bottom tab bar and navigation bars as accent-infused frosted glass
    /// that tracks the desktop palette and the accessibility environment. Reapplied
    /// to the live bars whenever the chrome or those settings change, so a desktop
    /// theme switch (or toggling Reduce Transparency) re-tints them without an app
    /// relaunch. Replaces a flat `.toolbarBackground(chrome.bgRaised, …)`.
    func glassBars() -> some View {
        modifier(GlassBars())
    }
}

private struct GlassBars: ViewModifier {
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .onAppear(perform: apply)
            .onChange(of: chrome) { apply() }
            .onChange(of: reduceTransparency) { apply() }
            .onChange(of: contrast) { apply() }
    }

    private func apply() {
        let increasedContrast = contrast == .increased
        let tabAppearance = UITabBarAppearance.glass(
            chrome: chrome, reduceTransparency: reduceTransparency, increasedContrast: increasedContrast)
        let navAppearance = UINavigationBarAppearance.glass(
            chrome: chrome, reduceTransparency: reduceTransparency, increasedContrast: increasedContrast)

        // The proxies style any bar created later (e.g. first launch)…
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance

        // …and the live bars are restyled in place so runtime theme changes show.
        for bar in UIApplication.shared.liveTabBars {
            bar.standardAppearance = tabAppearance
            bar.scrollEdgeAppearance = tabAppearance
        }
        for bar in UIApplication.shared.liveNavBars {
            bar.standardAppearance = navAppearance
            bar.scrollEdgeAppearance = navAppearance
            bar.compactAppearance = navAppearance
        }
    }
}

extension UITabBarAppearance {
    /// Build a tab-bar appearance from the palette: a blurred, accent-tinted
    /// background (or a solid themed one under Reduce Transparency), accent-tinted
    /// selected items, and a themed hairline shadow.
    static func glass(chrome: ChromePalette, reduceTransparency: Bool, increasedContrast: Bool) -> UITabBarAppearance {
        let appearance = UITabBarAppearance()
        let raised = UIColor(chrome.bgRaised)
        let accent = UIColor(chrome.accent)

        if reduceTransparency {
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = increasedContrast
                ? raised
                : raised.blended(with: accent, amount: 0.06)
            appearance.backgroundEffect = nil
        } else {
            appearance.configureWithDefaultBackground() // keeps the system blur
            let tint = increasedContrast ? raised : raised.blended(with: accent, amount: 0.12)
            appearance.backgroundColor = tint.withAlphaComponent(increasedContrast ? 0.95 : 0.55)
        }

        let normal = UIColor(chrome.textSecondary)
        for item in [appearance.stackedLayoutAppearance,
                     appearance.inlineLayoutAppearance,
                     appearance.compactInlineLayoutAppearance] {
            item.normal.iconColor = normal
            item.normal.titleTextAttributes = [.foregroundColor: normal]
            item.selected.iconColor = accent
            item.selected.titleTextAttributes = [.foregroundColor: accent]
        }

        appearance.shadowColor = increasedContrast
            ? UIColor(chrome.border)
            : UIColor(chrome.border).withAlphaComponent(0.4)
        return appearance
    }
}

extension UINavigationBarAppearance {
    /// Match the tab bar: a blurred, accent-tinted background (or a solid themed
    /// one under Reduce Transparency) with themed title text and hairline shadow,
    /// so pushed views (ChatView, FamiliarThreadsView) keep the desktop look.
    static func glass(chrome: ChromePalette, reduceTransparency: Bool, increasedContrast: Bool) -> UINavigationBarAppearance {
        let appearance = UINavigationBarAppearance()
        let raised = UIColor(chrome.bgRaised)
        let accent = UIColor(chrome.accent)

        if reduceTransparency {
            appearance.configureWithOpaqueBackground()
            appearance.backgroundColor = increasedContrast
                ? raised
                : raised.blended(with: accent, amount: 0.06)
            appearance.backgroundEffect = nil
        } else {
            appearance.configureWithDefaultBackground()
            let tint = increasedContrast ? raised : raised.blended(with: accent, amount: 0.12)
            appearance.backgroundColor = tint.withAlphaComponent(increasedContrast ? 0.95 : 0.55)
        }

        let title = UIColor(chrome.textPrimary)
        appearance.titleTextAttributes = [.foregroundColor: title]
        appearance.largeTitleTextAttributes = [.foregroundColor: title]
        appearance.shadowColor = increasedContrast
            ? UIColor(chrome.border)
            : UIColor(chrome.border).withAlphaComponent(0.4)
        return appearance
    }
}

private extension UIColor {
    /// Linear blend toward `other` by `amount` (0 = self, 1 = other). Used to wash
    /// a little accent into the surface colour for the accent-infused frost.
    func blended(with other: UIColor, amount: CGFloat) -> UIColor {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        guard getRed(&r1, green: &g1, blue: &b1, alpha: &a1),
              other.getRed(&r2, green: &g2, blue: &b2, alpha: &a2) else { return self }
        let t = max(0, min(1, amount))
        return UIColor(red: r1 + (r2 - r1) * t,
                       green: g1 + (g2 - g1) * t,
                       blue: b1 + (b2 - b1) * t,
                       alpha: a1 + (a2 - a1) * t)
    }
}

private extension UIApplication {
    /// Tab/nav bars currently on screen, found by walking the connected window
    /// scenes' view hierarchies — so appearance changes hit live bars in place.
    var liveTabBars: [UITabBar] { liveBars() }
    var liveNavBars: [UINavigationBar] { liveBars() }

    private func liveBars<T: UIView>() -> [T] {
        connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .flatMap { $0.descendants(ofType: T.self) }
    }
}

private extension UIView {
    func descendants<T: UIView>(ofType type: T.Type) -> [T] {
        var found: [T] = []
        if let match = self as? T { found.append(match) }
        for sub in subviews { found.append(contentsOf: sub.descendants(ofType: type)) }
        return found
    }
}
