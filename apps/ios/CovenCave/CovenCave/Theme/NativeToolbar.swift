import SwiftUI
import UIKit

/// Native iOS 26 toolbar treatment for the chat header (#5695).
///
/// iOS 26 draws toolbar items as Liquid Glass. Native toolbars (Markup, Mail)
/// share one glass capsule between related leading controls and give the
/// screen's main action a filled, tinted button. Earlier systems draw plain
/// glyphs, so these helpers leave iOS 18–25 exactly as it was.
enum NativeToolbar {
    /// True when the system renders toolbar items as Liquid Glass.
    static var usesLiquidGlass: Bool {
        if #available(iOS 26, *) { return true }
        return false
    }
}

extension View {
    /// The filled, tinted Liquid Glass style native toolbars reserve for the
    /// screen's primary action. Earlier systems keep the plain toolbar style.
    @ViewBuilder
    func prominentToolbarAction(tint: Color) -> some View {
        if #available(iOS 26, *) {
            buttonStyle(.glassProminent).tint(tint)
        } else {
            self
        }
    }

    /// On iOS 26 a toolbar title shrinks a little before truncating, as native
    /// inline titles do, so "Chat with Thoth" survives a full header.
    @ViewBuilder
    func nativeToolbarTitleScaling() -> some View {
        if NativeToolbar.usesLiquidGlass {
            minimumScaleFactor(0.8).allowsTightening(true)
        } else {
            self
        }
    }

    /// Lets a screen draw its own Back button inside a toolbar group on iOS 26.
    ///
    /// Reports through `canGoBack` whether UIKit's navigation stack holds a
    /// screen under this one. SwiftUI's `isPresented` cannot answer that: it is
    /// also true for an iPad split view's detail root, which has no Back. While
    /// the custom button is drawn the system one is hidden, and the edge-swipe
    /// back gesture (which SwiftUI disables along with the system button) is
    /// restored. iOS 18–25 keep the system Back button and gesture untouched.
    @ViewBuilder
    func groupedBackNavigation(canGoBack: Binding<Bool>) -> some View {
        if NativeToolbar.usesLiquidGlass {
            navigationBarBackButtonHidden(true)
                .background(
                    BackNavigationProbe(canGoBack: canGoBack)
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                )
        } else {
            self
        }
    }
}

private struct BackNavigationProbe: UIViewControllerRepresentable {
    @Binding var canGoBack: Bool

    func makeUIViewController(context: Context) -> Controller {
        Controller()
    }

    func updateUIViewController(_ controller: Controller, context: Context) {
        let binding = $canGoBack
        controller.report = { value in
            // Never write SwiftUI state from inside a view update. Every report
            // is queued and compared only when it runs: checking before the hop
            // could drop a newer value while an older one is still queued (a
            // split view reparenting reports false, then true), and that stale
            // write would leave Back hidden. FIFO order keeps the latest.
            DispatchQueue.main.async {
                if binding.wrappedValue != value { binding.wrappedValue = value }
            }
        }
        controller.refresh()
    }

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        var report: ((Bool) -> Void)?
        private weak var attachedTo: UINavigationController?
        private weak var previousDelegate: UIGestureRecognizerDelegate?

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            refresh()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            refresh()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            refresh()
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            detach()
        }

        /// A split view collapsing or expanding (rotation, iPad multitasking)
        /// moves the detail column in or out of the compact stack.
        override func viewWillTransition(
            to size: CGSize,
            with coordinator: UIViewControllerTransitionCoordinator
        ) {
            super.viewWillTransition(to: size, with: coordinator)
            coordinator.animate(alongsideTransition: nil) { [weak self] _ in
                self?.refresh()
            }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            refresh()
        }

        /// The screen this probe lives in, as an entry of `nav`'s stack.
        private func stackEntry(in nav: UINavigationController) -> UIViewController? {
            var candidate: UIViewController? = self
            while let current = candidate, current.parent !== nav {
                candidate = current.parent
            }
            return candidate
        }

        func refresh() {
            guard let nav = navigationController,
                  let entry = stackEntry(in: nav),
                  let index = nav.viewControllers.firstIndex(of: entry)
            else {
                report?(false)
                detach()
                return
            }
            let canGoBack = index > 0
            report?(canGoBack)
            if canGoBack, viewIfLoaded?.window != nil {
                attach(to: nav)
            } else {
                detach()
            }
        }

        private func attach(to nav: UINavigationController) {
            guard let pop = nav.interactivePopGestureRecognizer else { return }
            if pop.delegate === self { return }
            previousDelegate = pop.delegate
            attachedTo = nav
            pop.delegate = self
            pop.isEnabled = true
        }

        private func detach() {
            if let pop = attachedTo?.interactivePopGestureRecognizer, pop.delegate === self {
                pop.delegate = previousDelegate
            }
            attachedTo = nil
            previousDelegate = nil
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            (attachedTo?.viewControllers.count ?? 0) > 1
        }
    }
}
