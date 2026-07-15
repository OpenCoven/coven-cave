import SwiftUI

// MARK: - Chat chrome — shared tokens + small reusable controls
//
// The restyled chat experience is built from a handful of repeated shapes:
// circular glass icon buttons, capsule pill selectors, floating action menus,
// and icon+label rows. They live here (next to Theme/Glass) so every screen
// draws them identically instead of hand-rolling paddings per call site.
//
// Identity rules (arcane-terminal): near-black canvas comes from the published
// theme's bgBase; surfaces are the existing glass levels; the accent (violet /
// cyan depending on theme) appears ONLY on selected or active states via
// `accentGlow(active:)` — never as ambient decoration.

enum ChatChrome {
    /// Standard circular control diameter (composer attach, header actions).
    static let control: CGFloat = 34
    /// Compact circular control (nav-bar trailing actions).
    static let controlCompact: CGFloat = 30
    /// Corner radius for floating menus / suggestion rows.
    static let menuRadius: CGFloat = 20
    /// Circular icon "well" inside menu rows.
    static let iconWell: CGFloat = 34
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

/// A round glass icon button — the app's standard tap target for icon-only
/// actions. Always carries an accessibility label; the accent halo appears
/// only while `active` (selected/recording/etc.), keeping accent usage sparse.
struct CircularIconButton: View {
    let systemImage: String
    var size: CGFloat = ChatChrome.control
    var active: Bool = false
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.44, weight: .semibold))
                .foregroundStyle(active ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.secondary))
                .scaledControlFrame(size)
                .glass(.control, in: Circle())
                .accentGlow(active: active)
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel(label)
    }
}

// MARK: - PillSelector

/// A capsule chip that names a current choice and opens a picker: optional
/// leading view (avatar/icon), label, optional chevron. Used for the chat
/// header's agent pill and anywhere a compact "current value" control fits.
struct PillSelector<Leading: View>: View {
    var label: String
    var sublabel: String? = nil
    var chevron: Bool = true
    var active: Bool = false
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
                    if let sublabel {
                        Text(sublabel)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                if chevron {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .glass(.control, in: Capsule())
            .accentGlow(active: active)
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
/// icon-well + label rows on an elevated glass panel. The presenting view owns
/// the outside-tap scrim; rows dismiss on selection.
struct FloatingActionMenu: View {
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
                            .foregroundStyle(.primary)
                            .frame(width: ChatChrome.iconWell, height: ChatChrome.iconWell)
                            .glassFill(.raised, in: Circle())
                        Text(item.label)
                            .font(.body)
                            .foregroundStyle(.primary)
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
        .glass(.elevated, in: RoundedRectangle(cornerRadius: ChatChrome.menuRadius, style: .continuous))
        .accessibilityAddTraits(.isModal)
    }
}

// MARK: - DrawerRow

/// Icon + label row for the side drawer: quiet by default, accent-tinted only
/// while it names the active destination.
struct DrawerRow: View {
    let systemImage: String
    let label: String
    var detail: String? = nil
    var active: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(active ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.secondary))
                    .frame(width: 24)
                Text(label)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(active ? Color.accentColor.opacity(0.12) : .clear)
            )
        }
        .buttonStyle(GlassPressStyle(scale: 0.98))
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }
}

// MARK: - EmptyChatSuggestionRow

/// A spacious icon + short-label row for the empty chat state; tapping fills
/// the composer so the user can tweak before sending.
struct EmptyChatSuggestionRow: View {
    let systemImage: String
    let label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, height: 30)
                    .glassFill(.raised, in: Circle())
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .glass(.raised, in: RoundedRectangle(cornerRadius: ChatChrome.menuRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(GlassPressStyle(scale: 0.98))
        .accessibilityLabel(label)
        .accessibilityHint("Fills the message field")
    }
}
