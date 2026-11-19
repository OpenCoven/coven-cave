import SwiftUI

// MARK: - Chat chrome — shared tokens + small reusable controls
//
// The restyled chat experience is built from a handful of repeated shapes:
// circular icon buttons, capsule pill selectors, floating action menus,
// and icon+label rows. They live here (next to Theme/Glass) so every screen
// draws them identically instead of hand-rolling paddings per call site.
//
// Identity rules (arcane-terminal): near-black canvas comes from the published
// theme's bgBase; chat surfaces reuse the palette's neutral elevation levels.
// Accent remains available for real state and primary actions, never an
// ambient wash. Settings and other non-chat glass keeps its existing owner.

enum ChatChrome {
    /// Standard circular control diameter (composer attach, header actions).
    static let control: CGFloat = 34
    /// Compact circular control (nav-bar trailing actions).
    static let controlCompact: CGFloat = 30
    /// Corner radius for floating menus / suggestion rows.
    static let menuRadius: CGFloat = 20
    /// Circular icon "well" inside menu rows.
    static let iconWell: CGFloat = 34
    static let composerRadius: CGFloat = 28
    static let composerDraftHeight: CGFloat = 52
    static let messageRadius: CGFloat = 22
}

/// Opaque, palette-owned chat chrome. It remains the same readable surface
/// under Reduce Transparency, with a stronger outline for Increase Contrast.
/// Keeping this scoped to chat avoids changing the application's glass system.
private struct ChatSurfaceBackground<S: InsettableShape>: ViewModifier {
    let level: GlassLevel
    let shape: S
    var active: Bool
    @Environment(\.chrome) private var chrome
    @Environment(\.colorSchemeContrast) private var contrast

    private var fill: Color {
        switch level {
        case .chrome: return chrome.bgBase
        case .control, .raised: return chrome.bgRaised
        case .elevated: return chrome.bgElevated
        }
    }

    func body(content: Content) -> some View {
        content.background {
            shape.fill(fill)
                .overlay {
                    shape.strokeBorder(active ? chrome.borderStrong : chrome.borderHairline,
                                       lineWidth: contrast == .increased ? 1.5 : 0.6)
                }
        }
    }
}

extension View {
    func chatSurface<S: InsettableShape>(_ level: GlassLevel, in shape: S, active: Bool = false) -> some View {
        modifier(ChatSurfaceBackground(level: level, shape: shape, active: active))
    }

    func chatSurface(_ level: GlassLevel, cornerRadius: CGFloat = ChatChrome.menuRadius, active: Bool = false) -> some View {
        chatSurface(level, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), active: active)
    }
}

/// Shared editorial title treatment for primary iOS destinations. Large mode
/// belongs to the custom Chats header; compact mode fits a native toolbar.
struct EditorialSurfaceTitle: View {
    @Environment(\.chrome) private var chrome

    let title: String
    var detail: String?
    var large = false

    var body: some View {
        // Centred, not baseline-aligned: on the baseline the detail capsule
        // hangs below the serif title's visual middle.
        HStack(alignment: .center, spacing: large ? 8 : 6) {
            Text(title)
                .font(.system(size: large ? 32 : 20, weight: .semibold, design: .serif))
                .foregroundStyle(chrome.textPrimary)
                .lineLimit(1)
            if let detail {
                Text(detail)
                    .font((large ? Font.caption : Font.caption2).weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                    .padding(.horizontal, large ? 8 : 6)
                    .padding(.vertical, large ? 3 : 2)
                    .background(chrome.bgElevated, in: Capsule())
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - GlassPressStyle

/// The app's standard pressed state: a quick springy dip plus a slight dim, so
/// every glass control answers the finger the way native Apple controls do
/// (`.plain` gives no feedback at all on custom-backgrounded buttons). Under
/// Reduce Motion the scale is dropped and only the dim remains.
struct GlassPressStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? scale : 1))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 0.75),
                       value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == GlassPressStyle {
    /// Springy scale-on-press for glass chrome controls.
    static var glassPress: GlassPressStyle { GlassPressStyle() }
}

// MARK: - CircularIconButton

/// A neutral round button with a labelled, 44-point target. Active controls
/// use the shared stronger outline without adding a decorative accent wash.
struct CircularIconButton: View {
    @Environment(\.chrome) private var chrome
    let systemImage: String
    var size: CGFloat = ChatChrome.control
    var active: Bool = false
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.44, weight: .semibold))
                .foregroundStyle(active ? chrome.textPrimary : chrome.textSecondary)
                .scaledControlFrame(size)
                .chatSurface(.control, in: Circle(), active: active)
        }
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .buttonStyle(.glassPress)
        .accessibilityLabel(label)
    }
}

// MARK: - PillSelector

/// A capsule chip that names a current choice and opens a picker: optional
/// leading view (avatar/icon), label, optional chevron. Used for the chat
/// header's agent pill and anywhere a compact "current value" control fits.
struct PillSelector<Leading: View>: View {
    @Environment(\.chrome) private var chrome
    var label: String
    var sublabel: String? = nil
    var chevron: Bool = true
    var active: Bool = false
    var fillsWidth: Bool = false
    var accessibilityHint: String? = nil
    var action: () -> Void
    @ViewBuilder var leading: Leading

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                leading
                VStack(alignment: .leading, spacing: 0) {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .nativeToolbarTitleScaling()
                    if let sublabel {
                        Text(sublabel)
                            .font(.caption2)
                            .foregroundStyle(chrome.textPrimary)
                            .lineLimit(1)
                    }
                }
                if fillsWidth {
                    Spacer(minLength: 8)
                }
                if chevron {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(chrome.textSecondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: .leading)
            .frame(minHeight: 44)
            .chatSurface(.control, in: Capsule(), active: active)
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel(label)
        .accessibilityHint(accessibilityHint ?? "")
    }
}

// MARK: - FloatingActionMenu

/// One entry in the composer's floating "+" menu.
struct FloatingAction: Identifiable {
    let id: String
    let systemImage: String
    let label: String
    let action: () -> Void
}

/// The rounded menu that floats above the composer when "+" is tapped:
/// icon-well + label rows on an elevated neutral panel. The presenting view owns
/// the outside-tap scrim; rows dismiss on selection.
struct FloatingActionMenu: View {
    @Environment(\.chrome) private var chrome
    let actions: [FloatingAction]
    var onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(actions) { item in
                Button {
                    onDismiss()
                    item.action()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(chrome.textPrimary)
                            .frame(width: ChatChrome.iconWell, height: ChatChrome.iconWell)
                            .chatSurface(.raised, in: Circle())
                        Text(item.label)
                            .font(.body)
                            .foregroundStyle(chrome.textPrimary)
                        Spacer(minLength: 12)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(GlassPressStyle(scale: 0.98))
                .accessibilityLabel(item.label)
            }
        }
        .padding(6)
        .frame(maxWidth: 260, alignment: .leading)
        .chatSurface(.elevated, in: RoundedRectangle(cornerRadius: ChatChrome.menuRadius, style: .continuous))
        .accessibilityAddTraits(.isModal)
    }
}

// MARK: - EmptyChatSuggestionRow

/// A spacious icon + short-label row for the empty chat state; tapping fills
/// the composer so the user can tweak before sending.
struct EmptyChatSuggestionRow: View {
    @Environment(\.chrome) private var chrome
    let systemImage: String
    let label: String
    /// Optional muted second line (design's suggestion-card hint).
    var hint: String? = nil
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(chrome.textSecondary)
                    .frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(chrome.textPrimary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let hint {
                        Text(hint)
                            .font(.caption)
                            .foregroundStyle(chrome.textPrimary)
                            .lineLimit(1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(GlassPressStyle(scale: 0.98))
        .accessibilityLabel(hint == nil ? label : "\(label). \(hint!)")
        .accessibilityHint("Fills the message field")
    }
}
