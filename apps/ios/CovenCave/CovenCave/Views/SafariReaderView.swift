import SwiftUI
import SafariServices

/// In-app reader: an `SFSafariViewController` that opens straight into Reader
/// mode when the page supports it, for a clean, mobile-first reading view that
/// never leaves the app.
struct SafariReaderView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = true
        config.barCollapsingEnabled = true
        let controller = SFSafariViewController(url: url, configuration: config)
        controller.dismissButtonStyle = .done
        controller.preferredControlTintColor = UIColor.tintColor
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// Identifiable URL wrapper so a tapped link can drive `.sheet(item:)`.
struct ReaderLink: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}
