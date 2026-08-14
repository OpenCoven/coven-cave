import Foundation

/// The iOS copy of Cave's port contract.
///
/// Swift cannot import `scripts/ports.mjs`, so these numbers are duplicated on
/// purpose — the same two-place convention the Rust side uses in
/// `src-tauri/src/sidecar_ports.rs`. `scripts/port-contract.test.mjs` reads this
/// file and fails if any copy drifts, which matters more here than elsewhere:
/// iOS is not compiled by CI (see reference notes on apps/ios), so a wrong
/// number would otherwise reach a device before anything noticed.
///
/// Why it exists at all: the packaged desktop used to bind a random loopback
/// port on every launch, so a phone could not store a host and expect it to
/// resolve twice.
enum CavePorts {
    /// A packaged desktop app. This is what a paired phone should expect.
    static let production = 3020

    /// A `pnpm dev` server — the case where someone is running Cave from source
    /// on the Mac their phone is paired with.
    static let dev = 3000
}
