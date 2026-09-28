import SwiftUI
import UIKit

/// Reports once after UIKit has laid out a new token and the main queue reaches
/// the next display turn. This keeps view-body evaluation out of measurements
/// while giving navigation spans a deterministic first presented frame.
struct CavePerformanceStableFrame: UIViewRepresentable {
    let token: String
    var minimumDelay: TimeInterval = 0
    let report: @MainActor () -> Void

    func makeUIView(context: Context) -> ReporterView {
        ReporterView()
    }

    func updateUIView(_ uiView: ReporterView, context: Context) {
        uiView.schedule(token: token, minimumDelay: minimumDelay, report: report)
    }

    static func dismantleUIView(_ uiView: ReporterView, coordinator: Void) {
        uiView.cancelPendingReport()
    }

    @MainActor
    final class ReporterView: UIView {
        private var scheduledToken: String?
        private var reportedToken: String?
        private var generation: UInt64 = 0
        private var pendingReport: (() -> Void)?
        private var pendingWorkItem: DispatchWorkItem?
        private var displayLink: CADisplayLink?
        private var displayTicksRemaining = 0
        private var pendingMinimumDelay: TimeInterval = 0

        func schedule(
            token: String,
            minimumDelay: TimeInterval,
            report: @escaping @MainActor () -> Void
        ) {
            guard token != scheduledToken else { return }
            // A completed token may return while a different token is pending.
            // Supersede that pending report and measure the new presentation.
            guard scheduledToken != nil || token != reportedToken else { return }
            cancelPendingReport()
            generation &+= 1
            reportedToken = nil
            scheduledToken = token
            pendingReport = report
            pendingMinimumDelay = max(0, minimumDelay)
            setNeedsLayout()
            armReportIfReady()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            armReportIfReady()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil {
                pauseFrameDelivery()
            } else {
                armReportIfReady()
            }
        }

        private func armReportIfReady() {
            guard window != nil,
                  pendingWorkItem == nil,
                  displayLink == nil,
                  let token = scheduledToken
            else { return }

            let scheduledGeneration = generation
            let workItem = DispatchWorkItem { [weak self] in
                guard let self else { return }
                guard self.generation == scheduledGeneration,
                      self.scheduledToken == token else { return }
                self.pendingWorkItem = nil
                guard self.window != nil else { return }
                self.displayTicksRemaining = 2
                let displayLink = CADisplayLink(
                    target: self,
                    selector: #selector(self.displayLinkDidFire)
                )
                self.displayLink = displayLink
                displayLink.add(to: .main, forMode: .common)
            }
            pendingWorkItem = workItem
            DispatchQueue.main.asyncAfter(
                deadline: .now() + pendingMinimumDelay,
                execute: workItem
            )
        }

        @objc private func displayLinkDidFire() {
            guard window != nil else { pauseFrameDelivery(); return }
            guard displayTicksRemaining > 0 else {
                cancelPendingReport()
                return
            }
            displayTicksRemaining -= 1
            guard displayTicksRemaining == 0,
                  let token = scheduledToken,
                  token != reportedToken
            else { return }

            let report = pendingReport
            reportedToken = token
            scheduledToken = nil
            pendingReport = nil
            pendingWorkItem = nil
            displayLink?.invalidate()
            displayLink = nil
            report?()
        }

        private func pauseFrameDelivery() {
            generation &+= 1
            pendingWorkItem?.cancel()
            pendingWorkItem = nil
            displayLink?.invalidate()
            displayLink = nil
            displayTicksRemaining = 0
        }

        func cancelPendingReport() {
            pauseFrameDelivery()
            scheduledToken = nil
            pendingReport = nil
        }
    }
}
