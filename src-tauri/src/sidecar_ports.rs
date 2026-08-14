//! The Rust half of the port contract. Rust cannot import `scripts/ports.mjs`,
//! so these numbers are duplicated on purpose and `scripts/port-contract.test.mjs`
//! fails if the two copies ever disagree — the same two-place convention
//! `scripts/sidecar-bundle-deps.test.mjs` uses for the sidecar file-count budget.
//!
//! Before this, `find_free_port()` bound `127.0.0.1:0` and the packaged app took
//! a different port on every launch. See scripts/ports.mjs for why a moving port
//! is more than an inconvenience.

/// Fixed port for a packaged (release) build. Mirrors CAVE_PORTS.production.
pub(super) const CAVE_PRODUCTION_PORT: u16 = 3020;

/// Fixed port for a dev server. Mirrors CAVE_PORTS.dev.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) const CAVE_DEV_PORT: u16 = 3000;

/// Operator override, checked before the channel default. Mirrors CAVE_PORT_ENV.
pub(super) const CAVE_PORT_ENV: &str = "COVEN_CAVE_PORT";

/// Parses an override, rejecting anything outside the usable TCP range. Port 0
/// is refused deliberately: "bind anything" is the behaviour the dedicated port
/// exists to remove.
pub(super) fn parse_port(raw: &str) -> Option<u16> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    trimmed.parse::<u16>().ok().filter(|port| *port >= 1)
}

/// The port a packaged build should bind: `COVEN_CAVE_PORT` when it parses,
/// otherwise the dedicated production port. A malformed override is ignored
/// rather than fatal — a typo in a shell profile should not stop the app from
/// starting, and the resolved port is logged at startup either way.
pub(super) fn dedicated_port() -> u16 {
    std::env::var(CAVE_PORT_ENV)
        .ok()
        .as_deref()
        .and_then(parse_port)
        .unwrap_or(CAVE_PRODUCTION_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usable_ports_only() {
        assert_eq!(parse_port("3020"), Some(3020));
        assert_eq!(parse_port("  3020 "), Some(3020));
        assert_eq!(parse_port("65535"), Some(65535));
        // Port 0 means "bind anything" — the exact behaviour being retired.
        assert_eq!(parse_port("0"), None);
        assert_eq!(parse_port("70000"), None, "outside the u16 TCP range");
        assert_eq!(parse_port("30a20"), None);
        assert_eq!(parse_port(""), None);
        assert_eq!(parse_port("-1"), None);
    }

    #[test]
    fn channel_ports_are_distinct() {
        // A packaged build and a dev server must be able to run side by side;
        // that is the whole reason production does not simply reuse 3000.
        assert_ne!(CAVE_PRODUCTION_PORT, CAVE_DEV_PORT);
    }
}
