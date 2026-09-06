import SwiftUI
import UIKit

/// Reports once after UIKit has laid out a new token and the main queue reaches
/// the next display turn. This keeps view-body evaluation out of measurements
/// while giving navigation spans a deterministic first presented frame.
struct CavePerformanceStableFrame: UIViewRepresentable {
    let token: String
    let report: @MainActor () -> Void

    func makeUIView(context: Context) -> ReporterView {
        ReporterView()
    }

    func updateUIView(_ uiView: ReporterView, context: Context) {
        uiView.schedule(token: token, report: report)
    }

    @MainActor
    final class ReporterView: UIView {
        private var scheduledToken: String?
        private var reportedToken: String?
        private var report: (() -> Void)?

        func schedule(token: String, report: @escaping @MainActor () -> Void) {
            guard token != reportedToken, token != scheduledToken else { return }
            scheduledToken = token
            self.report = report
            setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            guard let token = scheduledToken, window != nil else { return }
            scheduledToken = nil
            DispatchQueue.main.async { [weak self] in
                guard let self, self.reportedToken != token else { return }
                self.reportedToken = token
                let report = self.report
                self.report = nil
                report?()
            }
        }
    }
}
