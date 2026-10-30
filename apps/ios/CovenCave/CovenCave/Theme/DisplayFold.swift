import SwiftUI

/// The hinge of a folding display (iPhone Duo's inner screen), in the
/// window's coordinate space.
///
/// iOS 27.1 reports the fold as a *division* reserved region: active while the
/// device is partly folded (book or tabletop pose), inactive while it lies
/// flat. Its frame is the hinge line plus interaction margins either side
/// (20pt each on the iPhone Duo simulator). One reader at the app root
/// publishes it through `\.displayFold`; it is `nil` on every other display.
///
/// Only fixed compositions move for it (`foldAvoiding`, and the split-view
/// columns via `sidebarColumn`/`splitDetailColumn`). Continuously scrolling
/// content — transcripts, lists, Settings — stays where it is, as Apple's
/// iPhone Duo guidance asks. The inner FaceTime camera's *occlusion* region
/// isn't read: it is active only while the front camera runs, and the app's
/// only camera UI (QR scanning, photo capture) is the system's own.
struct DisplayFold: Equatable, Sendable {
    /// The division region, in window coordinates.
    var frame: CGRect
    var isActive: Bool
    /// The whole window, safe areas included, so consumers can tell which
    /// side of the hinge has room.
    var window: CGRect

    /// `.vertical` when the hinge runs top to bottom (book pose on the open,
    /// landscape inner display); `.horizontal` when it runs side to side
    /// (tabletop, with the device rotated).
    var axis: Axis { frame.height >= frame.width ? .vertical : .horizontal }
}

private struct DisplayFoldKey: EnvironmentKey {
    static let defaultValue: DisplayFold? = nil
}

extension EnvironmentValues {
    var displayFold: DisplayFold? {
        get { self[DisplayFoldKey.self] }
        set { self[DisplayFoldKey.self] = newValue }
    }
}

/// Pure layout decisions around a fold, kept apart from the views so they can
/// be unit-tested without a folding device.
enum FoldLayout {
    /// The narrowest pane worth moving content into. Below it the content
    /// stays put rather than squeezing into a sliver beside the hinge.
    static let minimumPane: CGFloat = 280

    /// The leading-column width that puts a two-column split's boundary on an
    /// active book fold — the even split Apple's own split views take when the
    /// device folds — or `nil` when there is no such fold to honour.
    /// `container` and `fold` share one coordinate space.
    static func splitColumnWidth(container: CGRect, fold: DisplayFold?) -> CGFloat? {
        guard let fold, fold.isActive, fold.axis == .vertical else { return nil }
        let leading = fold.frame.midX - container.minX
        let trailing = container.maxX - fold.frame.midX
        guard leading >= minimumPane, trailing >= minimumPane else { return nil }
        return leading.rounded()
    }

    /// Insets that keep one fixed composition wholly on one side of an active
    /// fold crossing `container`. Book pose uses the trailing pane, nearer the
    /// outer display the content returns to when the device closes (where the
    /// system moves alerts too). Tabletop uses `tabletop`: the upper pane for
    /// something read at a distance, the lower one for controls, or neither
    /// (`nil`) for content that should stay put across a horizontal fold.
    static func avoidingInsets(
        container: CGRect,
        fold: DisplayFold?,
        tabletop: VerticalEdge?
    ) -> EdgeInsets {
        guard let fold, fold.isActive, container.intersects(fold.frame) else { return EdgeInsets() }
        switch fold.axis {
        case .vertical:
            let leading = fold.frame.maxX - container.minX
            guard leading > 0, container.maxX - fold.frame.maxX >= minimumPane else { return EdgeInsets() }
            return EdgeInsets(top: 0, leading: leading, bottom: 0, trailing: 0)
        case .horizontal:
            switch tabletop {
            case nil:
                return EdgeInsets()
            case .top:
                let bottom = container.maxY - fold.frame.minY
                guard bottom > 0, fold.frame.minY - container.minY >= minimumPane else { return EdgeInsets() }
                return EdgeInsets(top: 0, leading: 0, bottom: bottom, trailing: 0)
            case .bottom:
                let top = fold.frame.maxY - container.minY
                guard top > 0, container.maxY - fold.frame.maxY >= minimumPane else { return EdgeInsets() }
                return EdgeInsets(top: top, leading: 0, bottom: 0, trailing: 0)
            }
        }
    }
}

extension View {
    /// Publish the display's fold to every view below. Applied once, at the
    /// window root.
    func readsDisplayFold() -> some View {
        modifier(DisplayFoldReader())
    }

    /// Keep a fixed, centred composition — a lock or connect screen — clear
    /// of an active fold by moving it, as one unit, into a single pane. The
    /// view expands to fill its container first so the pane is measured
    /// against the whole screen rather than the content's own size.
    func foldAvoiding(tabletop: VerticalEdge? = .bottom) -> some View {
        modifier(FoldAvoiding(tabletop: tabletop))
    }
}

private struct DisplayFoldReader: ViewModifier {
    @State private var fold: DisplayFold?

    func body(content: Content) -> some View {
        content
            .environment(\.displayFold, fold)
            .onGeometryChange(for: DisplayFold?.self) { proxy in
                DisplayFoldReader.read(proxy)
            } action: { fold = $0 }
    }

    private static func read(_ proxy: GeometryProxy) -> DisplayFold? {
        let safe = proxy.frame(in: .global)
        let insets = proxy.safeAreaInsets
        let window = CGRect(
            x: safe.minX - insets.leading,
            y: safe.minY - insets.top,
            width: safe.width + insets.leading + insets.trailing,
            height: safe.height + insets.top + insets.bottom
        )
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-simulate-fold") {
            return simulatedFold(in: window)
        }
        #endif
        // The reserved-region API ships in the iOS 27.1 SDK (SwiftUI 8.0.85);
        // older toolchains, CI's included, compile this reader without it.
        #if canImport(SwiftUI, _version: 8.0.85)
        if #available(iOS 27.1, *) {
            guard let region = proxy.reservedRegions(kind: .division, options: .includeInactive).first
            else { return nil }
            return DisplayFold(
                frame: region.frame.offsetBy(dx: safe.minX, dy: safe.minY),
                isActive: region.isActive,
                window: window
            )
        }
        #endif
        return nil
    }

    #if DEBUG
    /// An active hinge across the middle of the window's long side, shaped like
    /// the region the iPhone Duo simulator reports: zero-width at the centre,
    /// with 20pt interaction margins either side. Neither `simctl` nor XCTest
    /// can fold that simulator, so UI tests and any simulator use this to
    /// exercise the folded layouts.
    private static func simulatedFold(in window: CGRect) -> DisplayFold {
        let margin: CGFloat = 20
        let frame = window.width >= window.height
            ? CGRect(x: window.midX - margin, y: window.minY, width: margin * 2, height: window.height)
            : CGRect(x: window.minX, y: window.midY - margin, width: window.width, height: margin * 2)
        return DisplayFold(frame: frame, isActive: true, window: window)
    }
    #endif
}

private struct FoldAvoiding: ViewModifier {
    let tabletop: VerticalEdge?

    @Environment(\.displayFold) private var fold
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var container: CGRect = .zero

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(FoldLayout.avoidingInsets(container: container, fold: fold, tabletop: tabletop))
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { container = $0 }
            .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: fold)
    }
}
