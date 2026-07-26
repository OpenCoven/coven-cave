import SwiftUI
import UIKit

/// An exportable archive on disk, wrapped so it can drive a `.sheet(item:)`.
struct ExportArchive: Identifiable {
    let id = UUID()
    let url: URL
}

/// Minimal `UIActivityViewController` wrapper for sharing file URLs (the system
/// share sheet — Save to Files, AirDrop, Mail, …).
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
