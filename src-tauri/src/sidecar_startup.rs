use super::*;
use std::collections::VecDeque;
use std::io::Read;

#[cfg(desktop)]
pub(super) const SIDECAR_OUTPUT_TAIL_BYTES: usize = 256 * 1024;

#[cfg(desktop)]
#[derive(Default)]
pub(super) struct SidecarOutputTail {
    bytes: VecDeque<u8>,
}

#[cfg(desktop)]
impl SidecarOutputTail {
    pub(super) fn push(&mut self, chunk: &[u8]) {
        if chunk.len() >= SIDECAR_OUTPUT_TAIL_BYTES {
            self.bytes.clear();
            self.bytes.extend(
                chunk[chunk.len() - SIDECAR_OUTPUT_TAIL_BYTES..]
                    .iter()
                    .copied(),
            );
            return;
        }

        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(SIDECAR_OUTPUT_TAIL_BYTES);
        if overflow > 0 {
            self.bytes.drain(..overflow);
        }
        self.bytes.extend(chunk.iter().copied());
    }

    #[cfg(test)]
    pub(super) fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }

    pub(super) fn text(&self) -> String {
        let bytes: Vec<u8> = self.bytes.iter().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[cfg(desktop)]
pub(super) fn capture_sidecar_output(
    mut reader: impl Read + Send + 'static,
    output: Arc<Mutex<SidecarOutputTail>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if let Ok(mut output) = output.lock() {
                        output.push(&buffer[..read]);
                    } else {
                        break;
                    }
                }
                Err(error) => {
                    log::warn!("[cave] sidecar output capture stopped: {error}");
                    break;
                }
            }
        }
    })
}

#[cfg(desktop)]
pub(super) fn sidecar_output_text(output: &Arc<Mutex<SidecarOutputTail>>) -> String {
    let captured = output
        .lock()
        .map(|output| output.text())
        .unwrap_or_else(|_| "(could not read sidecar output)".to_string());
    if captured.is_empty() {
        "(no output captured)".to_string()
    } else {
        captured
    }
}

/// Who is already on the dedicated loopback port.
///
/// The verdicts `classify_port_occupant` below can return. See that function
/// for why the conflict is resolved by identity rather than by relocating.
#[cfg(desktop)]
#[derive(Debug, PartialEq, Eq)]
pub(super) enum PortOccupant {
    /// Nothing accepted a connection.
    Free,
    /// Answered `/api/app/build-info` as CovenCave.
    ///
    /// Both a packaged copy and a `pnpm dev` server land here, and the probe
    /// cannot tell them apart — `/api/app/build-info` is deliberately
    /// value-free. A packaged copy answers even though it holds a sidecar
    /// token: `server.ts` stamps the local-peer header on any direct loopback
    /// request, and `src/proxy.ts` lets a trusted local peer through ordinary
    /// app APIs without one (`trustedLocalBrowserApi`). Reading only the token
    /// check in that file suggests a 401; the request never reaches it.
    ///
    /// That last part is true only of a copy built since #4874 (2026-08-22).
    /// v0.3.9 was stamped the day before, so every packaged copy in the field
    /// today answers 401 and lands in `Gated` below — until the field rolls
    /// forward, a dev server is the only thing that reaches this verdict.
    Cave,
    /// Answered, but refused the unauthenticated probe (401/403).
    ///
    /// Most often ANOTHER PACKAGED COVENCAVE — specifically one built before
    /// `trustedLocalBrowserApi` landed (#4874, 2026-08-22). v0.3.9 was stamped
    /// 2026-08-21, so no build in the field carries that bypass: every shipped
    /// copy answers 401 here rather than 200. Those builds also predate the
    /// port claim, so they take no lock and this is the verdict a second copy
    /// actually reaches during the whole upgrade window.
    ///
    /// Once the field has rolled forward it becomes the residual case instead:
    /// a Cave reached without `server.ts` in front of it, or something else
    /// gating the same path. Either way it stays its own verdict rather than
    /// being guessed in either direction.
    Gated,
    /// Accepted a connection but is not a Cave this build can name.
    Stranger,
}

/// Total wall-clock a loopback read LOOP may spend.
///
/// Not a hard ceiling: the deadline is checked before entering each
/// `read()`, so the worst case is this plus one `set_read_timeout` window.
///
/// Both readers on this path need one. The occupant probe talks to a program we
/// know nothing about, and the readiness handshake runs inside a loop whose
/// deadline is checked only BETWEEN calls — neither has a cancellation
/// checkpoint mid-read, so this is the whole budget for each.
#[cfg(desktop)]
const LOOPBACK_READ_BUDGET: Duration = Duration::from_secs(2);

/// Classify whoever holds `port`.
///
/// Replaces the old `find_free_port()`, which bound `127.0.0.1:0` and let the
/// kernel pick — that is what made the packaged app's port different on every
/// launch. See src-tauri/src/sidecar_ports.rs and scripts/ports.mjs for why a
/// moving port is more than an inconvenience.
///
/// A busy port is NOT worked around by relocating: relocating is exactly how
/// the address stopped being dependable in the first place. The conflict is
/// resolved by identity instead — the same verdict `scripts/dev-port-owner.mjs`
/// has been giving the dev launcher, read from the same value-free
/// `/api/app/build-info` route.
///
/// This can only ever narrow the window, never close it: an answer describes
/// the instant it was collected, and `node` binds seconds later.
/// `sidecar_port_lock` is what actually excludes a second copy; this exists to
/// say WHO, so the refusal names something instead of guessing.
///
/// One deliberate difference from `scripts/dev-port-owner.mjs`: it downgrades a
/// connected-but-silent port to "free" so the caller's own bind produces the
/// real error. Here the caller's "real error" is the `node` that dies on
/// `EADDRINUSE` and prints an error object at the operator — the outcome this
/// exists to prevent — so a completed TCP connection is never downgraded.
/// Something is listening; the only open question is who.
#[cfg(desktop)]
pub(super) fn classify_port_occupant(port: u16) -> PortOccupant {
    use std::io::Write;
    use std::net::{SocketAddr, TcpStream};

    const MAX_RESPONSE_BYTES: usize = 64 * 1024;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return PortOccupant::Free;
    };
    if stream
        .set_read_timeout(Some(Duration::from_millis(750)))
        .is_err()
        || stream
            .set_write_timeout(Some(Duration::from_millis(500)))
            .is_err()
    {
        return PortOccupant::Stranger;
    }
    if write!(
        stream,
        "GET /api/app/build-info HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return PortOccupant::Stranger;
    }
    classify_build_info_response(&read_bounded_response(stream, MAX_RESPONSE_BYTES))
}

/// Read at most `limit` bytes, and for at most `LOOPBACK_READ_BUDGET`.
///
/// `set_read_timeout` bounds each `read()`, not the total, and `Read::take`
/// bounds bytes rather than time — so `read_to_end` against an occupant that
/// trickles one byte inside every timeout window runs for as long as it cares
/// to. That is not hypothetical for this caller: it talks to whatever holds the
/// port, and the old `port_is_occupied` refused such a peer in 250 ms. Startup
/// has no cancellation checkpoint inside the probe, so an unbounded read here
/// freezes the Windows startup screen with a Retry button that reports
/// "sidecar startup is already running".
///
/// A short read is fine. Whatever arrived either parses as CovenCave or does
/// not, and every other outcome is `Stranger` — which is already the right
/// verdict for a peer that will not answer promptly.
#[cfg(desktop)]
fn read_bounded_response(mut stream: std::net::TcpStream, limit: usize) -> Vec<u8> {
    use std::io::Read;

    let deadline = Instant::now() + LOOPBACK_READ_BUDGET;
    let mut response = Vec::new();
    let mut chunk = [0_u8; 8192];
    while response.len() < limit && Instant::now() < deadline {
        let want = chunk.len().min(limit - response.len());
        match stream.read(&mut chunk[..want]) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&chunk[..read]),
            // `read_to_end` retried this and a bare `TcpStream::read` does not.
            // A signal delivered mid-response would otherwise truncate a
            // perfectly good answer and downgrade a real Cave to `Stranger`,
            // which selects the wrong instruction for the operator. The
            // deadline above still bounds the retry.
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    response
}

/// The verdict for a collected response. Split out from the socket work so the
/// classification is testable without a listener.
#[cfg(desktop)]
pub(super) fn classify_build_info_response(response: &[u8]) -> PortOccupant {
    let Some((status, body)) = parse_http_response(response) else {
        return PortOccupant::Stranger;
    };
    if matches!(status, 401 | 403) {
        return PortOccupant::Gated;
    }
    if status != 200 {
        return PortOccupant::Stranger;
    }
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(body.as_slice()) else {
        return PortOccupant::Stranger;
    };
    if payload.get("name").and_then(|name| name.as_str()) == Some("CovenCave") {
        PortOccupant::Cave
    } else {
        PortOccupant::Stranger
    }
}

/// Status code and decoded body of a bounded HTTP/1.x response, or `None` when
/// the bytes are not one this can read. Deliberately narrow: the only caller is
/// deciding who holds a port, and every parse failure means a stranger.
#[cfg(desktop)]
fn parse_http_response(response: &[u8]) -> Option<(u16, Vec<u8>)> {
    let separator = b"\r\n\r\n";
    let header_end = response
        .windows(separator.len())
        .position(|window| window == separator)?;
    let headers = std::str::from_utf8(&response[..header_end]).ok()?;
    let status = headers
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    let encoded = &response[header_end + separator.len()..];
    let body = if headers_declare_chunked(headers) {
        decode_chunked_body(encoded).ok()?
    } else {
        encoded.to_vec()
    };
    Some((status, body))
}

/// What to tell an operator whose copy lost the claim in `sidecar_port_lock`.
///
/// Only CovenCave takes that lock, so unlike the probe above this is never a
/// guess: a refused claim IS another copy of this app, and a live one — the OS
/// releases the lock when its holder's handle closes.
#[cfg(desktop)]
pub(super) fn already_running_message(port: u16, owner_pid: Option<u32>) -> String {
    let who = match owner_pid {
        Some(pid) => format!("CovenCave is already running (process {pid})"),
        None => "CovenCave is already running".to_string(),
    };
    format!(
        "{who} and is using port {port}.\n\n\
         Switch to the window that is already open, or quit it before starting another copy. {}",
        second_copy_hint()
    )
}

/// The operator-facing text for a port this copy cannot have.
#[cfg(desktop)]
pub(super) fn port_conflict_message(port: u16, occupant: &PortOccupant) -> String {
    match occupant {
        // Only reachable from the EADDRINUSE post-mortem in
        // `run_sidecar_runtime`: the squatter that killed the sidecar let go
        // again before we could ask who it was.
        PortOccupant::Free => format!(
            "Port {port} was taken by another program while CovenCave was starting, and is free \
             again now.\n\nRe-launch CovenCave."
        ),
        PortOccupant::Cave => format!(
            "Port {port} is already serving CovenCave — either another copy of the app, or a \
             dev server started with `pnpm dev`.\n\nSwitch to it, or stop it and re-launch. {}",
            second_copy_hint()
        ),
        PortOccupant::Gated => format!(
            "Port {port} is serving something that will not identify itself to this copy — most \
             often another CovenCave from an older build.\n\nSwitch to it, or quit it and \
             re-launch. {}",
            second_copy_hint()
        ),
        PortOccupant::Stranger => format!(
            "Port {port} is held by another program, so CovenCave cannot start its local \
             server.\n\nQuit whatever is using port {port} and re-launch. {}",
            second_copy_hint()
        ),
    }
}

/// Whether a dead sidecar's output tail says it failed to BIND, as opposed to
/// merely mentioning `EADDRINUSE` somewhere in 256 KiB of unrelated logging.
///
/// The distinction matters because the conflict message it selects tells the
/// operator to go quit a program — advice that is actively misleading if the
/// real failure was something else that happened to log the string. `server.ts`
/// prints a dedicated line for this, and Node's own message is
/// `listen EADDRINUSE: …`; anything looser would let one stray token in a
/// dependency's log rewrite the diagnosis.
#[cfg(desktop)]
pub(super) fn tail_reports_bind_conflict(tail: &str) -> bool {
    tail.contains("listen EADDRINUSE") || tail.contains("is already in use (EADDRINUSE)")
}

/// Every refusal names the same escape hatch, because `COVEN_CAVE_PORT` is what
/// makes "quit the other one" a choice rather than the only move — and the port
/// claim is keyed on the resolved port precisely so this stays true.
#[cfg(desktop)]
pub(super) fn second_copy_hint() -> String {
    format!(
        "To run a second copy alongside the first, start it with {} set to a free port.",
        sidecar_ports::CAVE_PORT_ENV
    )
}

/// Dev builds only: the dev-server URL from tauri.conf.json `build.devUrl`,
/// returned only when something is actually listening on it. Release builds
/// always get `None` so they can never be pointed away from the bundled
/// sidecar.
#[cfg(desktop)]
pub(super) fn live_dev_server_url(app: &tauri::App) -> Option<tauri::Url> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let url = app.config().build.dev_url.clone()?;
    let host = url.host_str()?.to_string();
    let port = url.port_or_known_default()?;
    let reachable = std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port))
        .ok()
        .map(|addrs| {
            addrs.into_iter().any(|addr| {
                std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok()
            })
        })
        .unwrap_or(false);
    if reachable {
        log::info!(
            "[cave] dev server live at {} — using it for the main webview (bundled sidecar skipped)",
            url
        );
        Some(url)
    } else {
        log::warn!(
            "[cave] dev build but {} is not serving — falling back to the bundled sidecar",
            url
        );
        None
    }
}

#[cfg(desktop)]
pub(super) fn wait_for_sidecar_ready(
    port: u16,
    auth_token: &str,
    output: &Arc<Mutex<SidecarOutputTail>>,
    timeout: Duration,
    should_cancel: impl Fn() -> bool,
    mut child_exited: impl FnMut() -> bool,
) -> PortWaitResult {
    // Require the launched sidecar's own ready log line, not just a listening
    // port — otherwise another process squatting the port would be trusted.
    let ready_line = format!("> Ready on http://127.0.0.1:{}", port);
    let deadline = Instant::now() + timeout;
    let mut last_handshake_error = None;
    while Instant::now() < deadline {
        if should_cancel() {
            return PortWaitResult::Cancelled;
        }
        if child_exited() {
            return PortWaitResult::Exited;
        }
        let logged_ready = output
            .lock()
            .map(|output| output.text().lines().any(|line| line.trim() == ready_line))
            .unwrap_or(false);
        if logged_ready {
            match authenticated_readiness_handshake(port, auth_token) {
                Ok(()) => return PortWaitResult::Ready,
                Err(error) => last_handshake_error = Some(error),
            }
        }
        thread::sleep(Duration::from_millis(150));
    }
    last_handshake_error.map_or(PortWaitResult::TimedOut, PortWaitResult::Refused)
}

#[cfg(desktop)]
#[derive(serde::Deserialize)]
struct NativeReadiness {
    service: String,
    version: String,
    protocol: NativeReadinessProtocol,
    runtime: NativeReadinessRuntime,
}

#[cfg(desktop)]
#[derive(serde::Deserialize)]
struct NativeReadinessProtocol {
    name: String,
    version: u32,
}

#[cfg(desktop)]
#[derive(serde::Deserialize)]
struct NativeReadinessRuntime {
    bundle: bool,
    api: String,
}

#[cfg(desktop)]
fn readiness_refusal(
    failure_class: ReliabilityFailureClass,
    message: impl Into<String>,
) -> SidecarReadinessRefusal {
    SidecarReadinessRefusal {
        message: message.into(),
        failure_class,
    }
}

#[cfg(desktop)]
fn authenticated_readiness_handshake(
    port: u16,
    auth_token: &str,
) -> Result<(), SidecarReadinessRefusal> {
    use std::io::Write;
    use std::net::{SocketAddr, TcpStream};

    const MAX_RESPONSE_BYTES: usize = 64 * 1024;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream =
        TcpStream::connect_timeout(&addr, Duration::from_millis(300)).map_err(|error| {
            readiness_refusal(
                ReliabilityFailureClass::Transport,
                format!("readiness connection failed: {error}"),
            )
        })?;
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| {
            readiness_refusal(
                ReliabilityFailureClass::Transport,
                format!("could not bound readiness response: {error}"),
            )
        })?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| {
            readiness_refusal(
                ReliabilityFailureClass::Transport,
                format!("could not bound readiness request: {error}"),
            )
        })?;
    write!(
        stream,
        "GET /api/app/native-readiness HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nx-coven-cave-token: {auth_token}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|error| {
        readiness_refusal(
            ReliabilityFailureClass::Transport,
            format!("readiness request failed: {error}"),
        )
    })?;

    // Bounded in time as well as bytes, for the reason spelled out on
    // `read_bounded_response`: `set_read_timeout` bounds each read and `take`
    // bounds bytes, so `read_to_end` runs as long as a peer keeps trickling.
    // It matters more here than at the probe, because the caller's deadline is
    // an illusion — `wait_for_sidecar_ready` checks it only between calls and
    // never polls `should_cancel` inside one. A sidecar that stalls mid-response
    // could therefore hold the startup worker far past its 60/90 s budget, and
    // the worker never reaching `finish()` leaves `running` pinned true, which
    // deadens Retry for the life of the process.
    //
    // The +1 is kept so an oversized response is still detected rather than
    // silently truncated to exactly the cap.
    let response = read_bounded_response(stream, MAX_RESPONSE_BYTES + 1);
    if response.len() > MAX_RESPONSE_BYTES {
        return Err(readiness_refusal(
            ReliabilityFailureClass::Transport,
            "readiness response exceeded 64 KiB",
        ));
    }
    validate_readiness_response_classified(&response)
}

#[cfg(desktop)]
pub(super) fn validate_readiness_response(response: &[u8]) -> Result<(), String> {
    validate_readiness_response_classified(response).map_err(|error| error.message)
}

#[cfg(desktop)]
pub(super) fn validate_readiness_response_classified(
    response: &[u8],
) -> Result<(), SidecarReadinessRefusal> {
    let separator = b"\r\n\r\n";
    let header_end = response
        .windows(separator.len())
        .position(|window| window == separator)
        .ok_or_else(|| {
            readiness_refusal(
                ReliabilityFailureClass::Transport,
                "readiness endpoint returned a malformed HTTP response",
            )
        })?;
    let headers = std::str::from_utf8(&response[..header_end]).map_err(|_| {
        readiness_refusal(
            ReliabilityFailureClass::Transport,
            "readiness endpoint returned non-UTF-8 headers",
        )
    })?;
    let status = headers.lines().next().unwrap_or_default();
    if status != "HTTP/1.1 200 OK" && status != "HTTP/1.0 200 OK" {
        let status_code = status.split_whitespace().nth(1);
        return Err(readiness_refusal(
            if matches!(status_code, Some("401" | "403")) {
                ReliabilityFailureClass::Authentication
            } else {
                ReliabilityFailureClass::Transport
            },
            format!("readiness endpoint refused the authenticated request ({status})"),
        ));
    }
    let encoded_body = &response[header_end + separator.len()..];
    let body = if headers_declare_chunked(headers) {
        decode_chunked_body(encoded_body)
            .map_err(|message| readiness_refusal(ReliabilityFailureClass::Transport, message))?
    } else {
        encoded_body.to_vec()
    };
    let readiness: NativeReadiness = serde_json::from_slice(&body).map_err(|error| {
        readiness_refusal(
            ReliabilityFailureClass::Compatibility,
            format!("readiness endpoint returned malformed JSON: {error}"),
        )
    })?;
    if readiness.service != "CovenCave" {
        return Err(readiness_refusal(
            ReliabilityFailureClass::Compatibility,
            "readiness endpoint belongs to an unexpected service",
        ));
    }
    if readiness.protocol.name != "coven-cave-native-readiness" || readiness.protocol.version != 1 {
        return Err(readiness_refusal(
            ReliabilityFailureClass::Compatibility,
            format!(
                "unsupported native readiness protocol {} v{}",
                readiness.protocol.name, readiness.protocol.version
            ),
        ));
    }
    if readiness.version != env!("CARGO_PKG_VERSION") {
        return Err(readiness_refusal(
            ReliabilityFailureClass::Compatibility,
            format!(
                "sidecar version {} is incompatible with desktop version {}",
                readiness.version,
                env!("CARGO_PKG_VERSION")
            ),
        ));
    }
    if !cfg!(debug_assertions) && !readiness.runtime.bundle {
        return Err(readiness_refusal(
            ReliabilityFailureClass::Compatibility,
            "release desktop reached a non-bundled sidecar runtime",
        ));
    }
    if readiness.runtime.api != "ready" {
        return Err(readiness_refusal(
            ReliabilityFailureClass::Compatibility,
            "sidecar API dependencies are not ready",
        ));
    }
    Ok(())
}

/// Whether a response's headers declare a chunked body.
///
/// Shared by the two HTTP readers on this path. They were separate copies of
/// the same block, which matters more than tidiness: the hostile-chunk fix
/// landed in the shared `decode_chunked_body`, but a fix to header parsing
/// would have had to be made twice, and the second one is easy to miss.
#[cfg(desktop)]
fn headers_declare_chunked(headers: &str) -> bool {
    headers.lines().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value
                    .split(',')
                    .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
        })
    })
}

#[cfg(desktop)]
fn decode_chunked_body(encoded: &[u8]) -> Result<Vec<u8>, String> {
    let mut remaining = encoded;
    let mut decoded = Vec::new();
    loop {
        let line_end = remaining
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or_else(|| "readiness endpoint returned malformed chunk framing".to_string())?;
        let size_line = std::str::from_utf8(&remaining[..line_end])
            .map_err(|_| "readiness endpoint returned non-UTF-8 chunk framing".to_string())?;
        let size_hex = size_line.split(';').next().unwrap_or_default().trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "readiness endpoint returned an invalid chunk size".to_string())?;
        remaining = &remaining[line_end + 2..];
        if size == 0 {
            if remaining == b"\r\n" || remaining.ends_with(b"\r\n\r\n") {
                return Ok(decoded);
            }
            return Err("readiness endpoint returned malformed chunk terminator".to_string());
        }
        // `size` is whatever the peer wrote in hex, so the trailer arithmetic
        // must not be allowed to wrap. Release builds carry no overflow checks,
        // and `FFFFFFFFFFFFFFFF\r\nx` makes `size + 2` wrap to 1 — which passes
        // the length test and then panics on `&remaining[usize::MAX..1]`.
        //
        // This body used to be reachable only after our own sidecar had logged
        // its ready line. The build-info probe now feeds it bytes from whoever
        // holds the port, on every launch, so a malformed chunk header has to
        // be an error rather than a crash: an unwind here would leave
        // `SidecarStartupControl.running` stuck true and permanently deaden the
        // Retry button.
        let chunk_end = size
            .checked_add(2)
            .ok_or_else(|| "readiness endpoint returned an out-of-range chunk size".to_string())?;
        if remaining.len() < chunk_end || &remaining[size..chunk_end] != b"\r\n" {
            return Err("readiness endpoint returned a truncated chunk".to_string());
        }
        decoded.extend_from_slice(&remaining[..size]);
        remaining = &remaining[chunk_end..];
    }
}

#[cfg(desktop)]
pub(super) fn sidecar_start_timeout() -> Duration {
    if cfg!(target_os = "windows") {
        Duration::from_secs(90)
    } else {
        Duration::from_secs(60)
    }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn node_arg_path(path: &Path) -> PathBuf {
    let raw = path.as_os_str().to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", stripped));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path.to_path_buf()
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub(super) fn node_arg_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Replace the main webview's dead/startup page without leaving it in session
/// history. Both first startup and later supervisor revivals use this exact
/// path so URL escaping and the native-navigation fallback cannot drift.
#[cfg(desktop)]
fn navigate_sidecar_window(window: &tauri::WebviewWindow, url: Url) -> Result<(), String> {
    let escaped = url.to_string().replace('"', "%22");
    window
        .eval(format!("window.location.replace(\"{escaped}\");"))
        .or_else(|_| window.navigate(url))
        .map_err(|error| format!("could not navigate the {} window: {error}", window.label()))
}

#[cfg(desktop)]
pub(super) fn refreshed_sidecar_window_url(startup_url: &Url, current_url: &Url) -> Url {
    let presentation_query: Vec<_> = current_url
        .query_pairs()
        .filter(|(key, _)| key != "covenCaveToken" && key != "coven_access_token")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let mut refreshed = startup_url.clone();
    refreshed.set_path(current_url.path());
    refreshed.set_fragment(current_url.fragment());
    for (key, value) in presentation_query {
        refreshed.query_pairs_mut().append_pair(&key, &value);
    }
    refreshed
}

#[cfg(desktop)]
pub(super) fn replace_main_window_url(app: &tauri::AppHandle, url: Url) -> Result<(), String> {
    let main_windows = main_webview_windows(app);
    if main_windows.is_empty() {
        return Err("main window is unavailable".to_string());
    }
    for main_window in main_windows {
        let target = match main_window.url() {
            Ok(current) => refreshed_sidecar_window_url(&url, &current),
            Err(_) => url.clone(),
        };
        navigate_sidecar_window(&main_window, target)?;
    }

    for label in [QUICK_CHAT_WINDOW_LABEL, NOTCH_WINDOW_LABEL] {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        let target = match window.url() {
            Ok(current) => refreshed_sidecar_window_url(&url, &current),
            Err(error) => {
                log::warn!(
                    "[cave] could not inspect the {label} window during sidecar recovery: {error}; closing the stale auxiliary window"
                );
                let _ = window.close();
                continue;
            }
        };
        if let Err(error) = navigate_sidecar_window(&window, target) {
            log::warn!("[cave] {error}; closing the stale auxiliary window");
            let _ = window.close();
        }
    }

    Ok(())
}

#[cfg(desktop)]
pub(super) fn start_sidecar_runtime(
    app: &tauri::AppHandle,
    operation: &'static str,
    attempt: u32,
    mut on_step: impl FnMut(SidecarStartupStep),
    should_cancel: impl Fn() -> bool,
) -> Result<Url, SidecarStartError> {
    let diagnostics = sidecar_diagnostics::SidecarDiagnosticContext::new(
        operation,
        attempt,
        app.package_info().version.to_string(),
        app.path()
            .app_local_data_dir()
            .ok()
            .map(|directory| directory.join(sidecar_diagnostics::NATIVE_DIAGNOSTICS_FILE_NAME)),
    );
    let lifecycle_phase = if operation == "sidecar-recovery" {
        "recovery"
    } else {
        "startup"
    };
    diagnostics.record(lifecycle_phase, "started", "dedicated-sidecar", None, None);
    let result = run_sidecar_runtime(app, &diagnostics, &mut on_step, should_cancel);
    match &result {
        Ok(_) => diagnostics.record(lifecycle_phase, "succeeded", "ready", None, None),
        Err(SidecarStartError::Cancelled) => {
            diagnostics.record(lifecycle_phase, "cancelled", "cancelled", None, None)
        }
        Err(SidecarStartError::Failed { .. }) => {
            let failed_phase = diagnostics.current_phase();
            diagnostics.record(
                failed_phase,
                "failed",
                "startup-failed",
                Some("sidecar-start-failed"),
                None,
            )
        }
    }
    result
}

#[cfg(desktop)]
fn run_sidecar_runtime(
    app: &tauri::AppHandle,
    diagnostics: &sidecar_diagnostics::SidecarDiagnosticContext,
    on_step: &mut impl FnMut(SidecarStartupStep),
    should_cancel: impl Fn() -> bool,
) -> Result<Url, SidecarStartError> {
    diagnostics.record(
        "preparing-runtime",
        "started",
        "resource-discovery",
        None,
        None,
    );
    on_step(SidecarStartupStep::PreparingRuntime);
    let resource_dir = app.path().resource_dir().map_err(|error| {
        SidecarStartError::failed(
            ReliabilityFailureClass::Permissions,
            format!("could not resolve resource dir: {error}"),
        )
    })?;

    #[cfg(target_os = "windows")]
    let server_dir_root =
        sidecar_archive::prepare_sidecar_runtime(app, &resource_dir).map_err(|error| {
            SidecarStartError::failed(
                ReliabilityFailureClass::Compatibility,
                format!("could not prepare sidecar runtime: {error}"),
            )
        })?;
    #[cfg(not(target_os = "windows"))]
    let server_dir_root = resource_dir.join("resources").join("server");

    if should_cancel() {
        return Err(SidecarStartError::Cancelled);
    }

    let server_mjs = server_dir_root.join("server.mjs");
    let server_js = server_dir_root.join("server.js");
    let server_entry = if server_mjs.exists() {
        server_mjs
    } else if server_js.exists() {
        log::warn!(
            "[cave] bundle has no server.mjs - terminal websocket bridge unavailable in this build"
        );
        server_js
    } else {
        return Err(SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            format!("standalone server not found at {}", server_js.display()),
        ));
    };

    let port = sidecar_ports::dedicated_port();
    // Take the claim BEFORE looking at the port. The probe below can only
    // describe the instant it ran, and two copies launched together do not race
    // by chance — they queue on `.runtime-cache.lock` while one extracts the
    // runtime, which releases the loser into exactly the window where the
    // winner has finished extracting and has not yet bound. The claim is what
    // makes that ordering harmless (sidecar_port_lock.rs).
    //
    // The setup hook already claimed this port, so in practice the call below
    // hits the same-process short-circuit and returns `Acquired`. That is
    // deliberate defence in depth rather than dead weight: the `HeldBy` arm is
    // still reachable when the setup claim itself failed open, which is exactly
    // the case where nothing else is guarding the port.
    match app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not resolve local app data: {error}"))
        .and_then(|state_dir| crate::sidecar_port_lock::claim_dedicated_port(&state_dir, port))
    {
        Ok(crate::sidecar_port_lock::PortClaim::Acquired) => {}
        Ok(crate::sidecar_port_lock::PortClaim::HeldBy { pid }) => {
            return Err(SidecarStartError::failed(
                ReliabilityFailureClass::Contention,
                already_running_message(port, pid),
            ));
        }
        // Fail open. A claim that cannot be evaluated is a worse reason to
        // refuse startup than the conflict it was meant to catch, and the probe
        // below plus the EADDRINUSE post-mortem still describe what happens
        // next.
        Err(error) => {
            log::warn!("[cave] could not claim the dedicated port {port}: {error}");
        }
    }

    // Name the conflict instead of relocating. The old behaviour asked the
    // kernel for any free port, which always "worked" and left the app on a
    // different address every launch — including in the pairing-secret path
    // (`mobile-tailscale-${port}`), so phones could not find it twice.
    let occupant = classify_port_occupant(port);
    if occupant != PortOccupant::Free {
        return Err(SidecarStartError::failed(
            ReliabilityFailureClass::Contention,
            port_conflict_message(port, &occupant),
        ));
    }
    let auth_token = sidecar_auth_token();
    let mobile_access_token = mobile_access_token_for_app(app);
    log::info!("[cave] starting sidecar on port {port}");

    let node = find_node(&resource_dir).ok_or_else(|| {
        SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            "Could not find a `node` binary. Install Node.js from https://nodejs.org and re-launch CovenCave."
                .to_string(),
        )
    })?;
    log::info!("[cave] using node at {}", node.display());
    let piper = bundled_piper_path(&resource_dir);
    if !cfg!(debug_assertions) && !piper.is_file() {
        return Err(SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            format!("bundled Piper runtime not found at {}", piper.display()),
        ));
    }
    if piper.is_file() {
        log::info!("[cave] using bundled Piper at {}", piper.display());
    } else {
        log::warn!(
            "[cave] bundled Piper is unavailable in development; local voices will use an explicit COVEN_PIPER_BIN or PATH fallback"
        );
    }
    let kokoro = bundled_kokoro_path(&resource_dir);
    if !cfg!(debug_assertions) && !kokoro.is_file() {
        return Err(SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            format!("bundled Kokoro runtime not found at {}", kokoro.display()),
        ));
    }
    if kokoro.is_file() {
        log::info!("[cave] using bundled Kokoro at {}", kokoro.display());
    } else {
        log::warn!(
            "[cave] bundled Kokoro is unavailable in development; Kokoro voices will use an explicit COVEN_KOKORO_BIN or PATH fallback"
        );
    }
    let whisper_cli = find_bundled_whisper_cli(&resource_dir).ok_or_else(|| {
        SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            "Could not find the bundled local Whisper runtime. Reinstall CovenCave or contact support."
                .to_string(),
        )
    })?;
    log::info!("[cave] using bundled Whisper at {}", whisper_cli.display());

    // Keep startup evidence in one fixed-size memory tail. Reader threads keep
    // draining both pipes for the sidecar's lifetime, so successful launches
    // do not leave persistent per-process log files behind.
    let sidecar_output = Arc::new(Mutex::new(SidecarOutputTail::default()));

    let server_dir = server_entry.parent().ok_or_else(|| {
        SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            "server entry has no parent directory",
        )
    })?;
    let server_js_arg = node_arg_path(&server_entry);
    let server_dir_arg = node_arg_path(server_dir);
    // The sidecar's old-space ceiling, chosen rather than inherited from host
    // memory. Built as a whole vector because node only honours V8 flags that
    // appear BEFORE the entry path — see src-tauri/src/sidecar_heap.rs.
    let node_args = sidecar_heap::sidecar_node_args(&server_js_arg);

    let path_sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let default_path = if cfg!(target_os = "windows") {
        std::env::var("PATH").unwrap_or_else(|_| "C:\\Windows\\system32;C:\\Windows".into())
    } else {
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".into())
    };
    let mut augmented_path = default_path;
    if let Some(directory) = node.parent() {
        augmented_path = format!("{}{}{}", directory.display(), path_sep, augmented_path);
    }
    match find_coven() {
        Some(coven) => {
            // Name the lane, not just the path: this is the line read while
            // working out which CLI is in play, and a path alone cannot say
            // whether a COVEN_BIN override was honored.
            log::info!(
                "[cave] using coven at {} (source: {})",
                coven.path.display(),
                coven.source.label()
            );
            if let Some(directory) = coven.path.parent() {
                augmented_path = format!("{}{}{}", directory.display(), path_sep, augmented_path);
            }
        }
        None => log::warn!("[cave] `coven` CLI not found on disk - onboarding will prompt install"),
    }

    diagnostics.record(
        "preparing-runtime",
        "succeeded",
        "runtime-ready",
        None,
        None,
    );
    diagnostics.record("sidecar-spawn", "started", "node-process", None, None);
    on_step(SidecarStartupStep::StartingService);
    if should_cancel() {
        return Err(SidecarStartError::Cancelled);
    }

    #[cfg(target_os = "windows")]
    let (mut command, process_job, launch_gate) = {
        let process_job = windows_process_job::ProcessJob::new().map_err(|error| {
            diagnostics.record_io_error("sidecar-spawn", "process-job-failed", &error);
            SidecarStartError::failed(
                ReliabilityFailureClass::Permissions,
                format!("could not create sidecar process job: {error}"),
            )
        })?;
        let launch_gate = windows_process_job::ProcessLaunchGate::new().map_err(|error| {
            diagnostics.record_io_error("sidecar-spawn", "launch-gate-failed", &error);
            SidecarStartError::failed(
                ReliabilityFailureClass::Permissions,
                format!("could not create sidecar launch gate: {error}"),
            )
        })?;
        let launcher = launch_gate
            .launcher(&node, &node_args)
            .map_err(|error| {
                diagnostics.record_io_error("sidecar-spawn", "launcher-preparation-failed", &error);
                SidecarStartError::failed(
                    ReliabilityFailureClass::Permissions,
                    format!("could not prepare sidecar launch gate: {error}"),
                )
            })?;
        (launcher.into_std_command(), process_job, launch_gate)
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new(&node);
        command.args(&node_args);
        command
    };
    command
        .current_dir(&server_dir_arg)
        .env("PATH", &augmented_path)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("COVEN_WHISPER_CPP_BIN", &whisper_cli)
        .env("COVEN_CAVE_AUTH_TOKEN", &auth_token)
        .env("COVEN_CAVE_ACCESS_TOKEN", &mobile_access_token)
        .env(
            sidecar_diagnostics::CORRELATION_ID_ENV,
            &diagnostics.correlation_id,
        )
        .env(
            sidecar_diagnostics::DIAGNOSTIC_GENERATION_ENV,
            diagnostics.generation.to_string(),
        )
        .env(
            sidecar_diagnostics::DIAGNOSTIC_OPERATION_ENV,
            diagnostics.operation,
        )
        .env(
            sidecar_diagnostics::DIAGNOSTIC_ATTEMPT_ENV,
            diagnostics.attempt.to_string(),
        )
        .env(
            sidecar_diagnostics::NATIVE_VERSION_ENV,
            &diagnostics.cave_version,
        )
        .env(sidecar_diagnostics::NATIVE_PROTOCOL_VERSION_ENV, "1");
    if let Some(path) = diagnostics.diagnostics_file.as_deref() {
        command.env(sidecar_diagnostics::NATIVE_DIAGNOSTICS_FILE_ENV, path);
    }

    if cfg!(debug_assertions) {
        // Development uses the explicit COVEN_PIPER_BIN/PATH fallback from the
        // Node runner. A clean checkout has only the resource placeholder.
        command.env_remove("COVEN_CAVE_BUNDLE");
    } else {
        command.env("COVEN_CAVE_BUNDLE", "1");
    }
    if piper.is_file() {
        command.env("COVEN_PIPER_BIN", node_arg_path(&piper));
    }
    if kokoro.is_file() {
        command.env("COVEN_KOKORO_BIN", node_arg_path(&kokoro));
    }

    // Ubuntu's pinned whisper.cpp archive keeps its shared objects next to the
    // CLI. Constrain the loader path to that bundled directory so the local
    // runner never depends on system libraries or a developer's shell setup.
    #[cfg(target_os = "linux")]
    if let Some(whisper_dir) = whisper_cli.parent() {
        command.env("LD_LIBRARY_PATH", whisper_dir);
    }

    #[cfg(unix)]
    configure_unix_sidecar_parent_watchdog(&mut command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = command.spawn().map_err(|error| {
        diagnostics.record_io_error("sidecar-spawn", "spawn-failed", &error);
        SidecarStartError::failed(
            ReliabilityFailureClass::Permissions,
            format!("failed to spawn node sidecar: {error}"),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        SidecarStartError::failed(
            ReliabilityFailureClass::ProcessExit,
            "node sidecar stdout pipe was unavailable",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        SidecarStartError::failed(
            ReliabilityFailureClass::ProcessExit,
            "node sidecar stderr pipe was unavailable",
        )
    })?;
    capture_sidecar_output(stdout, Arc::clone(&sidecar_output));
    capture_sidecar_output(stderr, Arc::clone(&sidecar_output));
    #[cfg(target_os = "windows")]
    let child = {
        if let Err(error) = process_job.assign_child(&child) {
            diagnostics.record_io_error("sidecar-spawn", "process-ownership-failed", &error);
            let _ = child.kill();
            return Err(SidecarStartError::failed(
                ReliabilityFailureClass::Permissions,
                format!("could not assign sidecar launch gate to process job: {error}"),
            ));
        }
        if let Err(error) = launch_gate.release() {
            diagnostics.record_io_error("sidecar-spawn", "launch-gate-release-failed", &error);
            let _ = process_job.terminate();
            let _ = child.kill();
            return Err(SidecarStartError::failed(
                ReliabilityFailureClass::Permissions,
                format!("could not release sidecar launch gate: {error}"),
            ));
        }
        SidecarProcess::from_gated(child, process_job)
    };
    #[cfg(not(target_os = "windows"))]
    let child = SidecarProcess::new(child);
    let sidecar_pid = child.id();
    let sidecar_state = app.state::<SidecarState>();
    match sidecar_state.0.lock() {
        Ok(mut sidecar) => *sidecar = Some(child),
        Err(_) => {
            let cleanup = stop_sidecar_child(child)
                .err()
                .map(|error| format!("; cleanup also failed: {error}"))
                .unwrap_or_default();
            return Err(SidecarStartError::failed(
                ReliabilityFailureClass::Unknown,
                format!("sidecar process lock is poisoned{cleanup}"),
            ));
        }
    }

    diagnostics.record("sidecar-spawn", "succeeded", "process-owned", None, None);
    diagnostics.record("readiness", "started", "authenticated-loopback", None, None);
    on_step(SidecarStartupStep::WaitingForService);
    let sidecar_start_timeout = sidecar_start_timeout();
    let child_exited = || {
        sidecar_state
            .0
            .lock()
            .map(|mut sidecar| {
                sidecar
                    .as_mut()
                    .is_none_or(|sidecar| sidecar.has_exited().unwrap_or(true))
            })
            .unwrap_or(true)
    };
    match wait_for_sidecar_ready(
        port,
        &auth_token,
        &sidecar_output,
        sidecar_start_timeout,
        &should_cancel,
        child_exited,
    ) {
        PortWaitResult::Ready => {}
        PortWaitResult::Cancelled => return Err(SidecarStartError::Cancelled),
        result @ (PortWaitResult::Exited
        | PortWaitResult::Refused(_)
        | PortWaitResult::TimedOut) => {
            let tail = sidecar_output_text(&sidecar_output);
            // Last line of defence, and the one that would have made the
            // original report legible. The claim above makes a lost bind
            // unreachable between two managed copies, but nothing can claim the
            // port on behalf of a stranger that arrives mid-startup. When that
            // happens the evidence is already in the tail, and reading it is
            // the difference between naming the conflict and pasting node's
            // error object at someone whose only real problem is that the
            // address is taken.
            if matches!(result, PortWaitResult::Exited) && tail_reports_bind_conflict(&tail) {
                return Err(SidecarStartError::failed(
                    ReliabilityFailureClass::Contention,
                    format!(
                        "{}

Bounded sidecar output tail:
{}",
                        port_conflict_message(port, &classify_port_occupant(port)),
                        tail
                    ),
                ));
            }
            let failure_class = match &result {
                PortWaitResult::Exited => ReliabilityFailureClass::ProcessExit,
                PortWaitResult::TimedOut => ReliabilityFailureClass::Timeout,
                PortWaitResult::Refused(refusal) => refusal.failure_class,
                _ => ReliabilityFailureClass::Unknown,
            };
            let reason = match result {
                PortWaitResult::Exited => "exited before becoming ready".to_string(),
                PortWaitResult::Refused(refusal) => {
                    format!(
                        "failed its authenticated readiness handshake: {}",
                        refusal.message
                    )
                }
                PortWaitResult::TimedOut => format!(
                    "did not become ready within {}s",
                    sidecar_start_timeout.as_secs()
                ),
                _ => unreachable!(),
            };
            return Err(SidecarStartError::failed(
                failure_class,
                format!(
                    "Sidecar (node {}) {} on port {}.\n\nBounded sidecar output tail:\n{}",
                    node.display(),
                    reason,
                    port,
                    tail
                ),
            ));
        }
    }
    diagnostics.record(
        "readiness",
        "succeeded",
        "authenticated-loopback",
        None,
        None,
    );

    sidecar_reachability_ready(app, port, sidecar_pid);

    #[cfg(target_os = "windows")]
    sidecar_archive::cleanup_stale_sidecar_runtimes(&server_dir_root);

    format!(
        "http://127.0.0.1:{port}/?covenCaveToken={auth_token}&coven_access_token={mobile_access_token}"
    )
    .parse()
    .map_err(|error| {
        SidecarStartError::failed(
            ReliabilityFailureClass::Compatibility,
            format!("could not build sidecar URL: {error}"),
        )
    })
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn publish_sidecar_startup_status(
    app: &tauri::AppHandle,
    control: &SidecarStartupControl,
    status: SidecarStartupStatus,
) -> Result<(), String> {
    control.set_status(status.clone())?;
    let mut first_error = None;
    for window in main_webview_windows(app) {
        if let Err(error) = window.emit(SIDECAR_STARTUP_EVENT, status.clone()) {
            if first_error.is_none() {
                first_error = Some(format!("could not publish sidecar startup status: {error}"));
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

#[cfg(all(desktop, target_os = "windows"))]
#[derive(Clone, Copy)]
pub(super) enum NativeStartupTerminalPolicy {
    RecordAtLifecycleTerminal,
    DeferredToSupervisor,
}

#[cfg(all(desktop, target_os = "windows"))]
fn finish_sidecar_startup(
    app: &tauri::AppHandle,
    control: &SidecarStartupControl,
    terminal_policy: NativeStartupTerminalPolicy,
    duration: Duration,
    evidence: NativeStartupTerminalEvidence,
) {
    match terminal_policy {
        NativeStartupTerminalPolicy::RecordAtLifecycleTerminal => {
            record_native_startup_terminal(app, duration, evidence);
            control.finish();
        }
        NativeStartupTerminalPolicy::DeferredToSupervisor => {
            if let Err(error) = control.finish_with_terminal(evidence) {
                log::warn!("[cave] could not publish supervised startup terminal result: {error}");
            }
        }
    }
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn spawn_sidecar_startup(
    app: tauri::AppHandle,
    control: Arc<SidecarStartupControl>,
    terminal_policy: NativeStartupTerminalPolicy,
    operation: &'static str,
    attempt: u32,
) -> Result<(), String> {
    control.begin()?;
    let started = Instant::now();
    if let Err(error) =
        publish_sidecar_startup_status(&app, &control, SidecarStartupStatus::preparing())
    {
        finish_sidecar_startup(
            &app,
            &control,
            terminal_policy,
            started.elapsed(),
            NativeStartupTerminalEvidence::Failed(ReliabilityFailureClass::Unknown),
        );
        return Err(error);
    }

    let thread_control = Arc::clone(&control);
    let worker_app = app.clone();
    let spawn_result = thread::Builder::new()
        .name("coven-sidecar-startup".to_string())
        .spawn(move || {
            let app = worker_app;
            let progress_app = app.clone();
            let progress_control = Arc::clone(&thread_control);
            let cancel_control = Arc::clone(&thread_control);
            let result = start_sidecar_runtime(
                &app,
                operation,
                attempt,
                move |step| {
                    let status = match step {
                        SidecarStartupStep::PreparingRuntime => SidecarStartupStatus::preparing(),
                        SidecarStartupStep::StartingService => SidecarStartupStatus::starting(),
                        SidecarStartupStep::WaitingForService => SidecarStartupStatus::waiting(),
                    };
                    if let Err(error) = publish_sidecar_startup_status(
                        &progress_app,
                        &progress_control,
                        status,
                    ) {
                        log::warn!("[cave] {error}");
                    }
                },
                move || cancel_control.is_cancelled(),
            );

            let (final_status, terminal_evidence) = match result {
                Ok(_url) if thread_control.is_cancelled() => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(error) = sidecar.stop_after_startup_attempt() {
                            log::warn!("[cave] could not stop cancelled sidecar: {error}");
                        }
                    }
                    (
                        SidecarStartupStatus::cancelled(),
                        NativeStartupTerminalEvidence::Cancelled,
                    )
                }
                Ok(url) => {
                    pty::trust_main_origin(&url);
                    remember_main_startup_url(&url);
                    // location.replace() swaps startup.html out of session
                    // history; native navigation is the shared fallback when
                    // the page's JS context is unreachable.
                    let navigation = replace_main_window_url(&app, url);
                    match navigation {
                        Ok(()) => (
                            SidecarStartupStatus::ready(),
                            NativeStartupTerminalEvidence::AuthenticatedReady,
                        ),
                        Err(error) => {
                            if let Some(sidecar) = app.try_state::<SidecarState>() {
                                if let Err(stop_error) = sidecar.stop_after_startup_attempt() {
                                    log::warn!(
                                        "[cave] could not stop sidecar after navigation failure: {stop_error}"
                                    );
                                }
                            }
                            (
                                SidecarStartupStatus::failed(error),
                                NativeStartupTerminalEvidence::Failed(
                                    ReliabilityFailureClass::Transport,
                                ),
                            )
                        }
                    }
                }
                Err(SidecarStartError::Cancelled) => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(error) = sidecar.stop_after_startup_attempt() {
                            log::warn!("[cave] could not stop cancelled sidecar: {error}");
                        }
                    }
                    (
                        SidecarStartupStatus::cancelled(),
                        NativeStartupTerminalEvidence::Cancelled,
                    )
                }
                Err(SidecarStartError::Failed {
                    message,
                    failure_class,
                }) => {
                    if let Some(sidecar) = app.try_state::<SidecarState>() {
                        if let Err(stop_error) = sidecar.stop_after_startup_attempt() {
                            log::warn!(
                                "[cave] could not stop sidecar after startup failure: {stop_error}"
                            );
                        }
                    }
                    (
                        SidecarStartupStatus::failed(message),
                        NativeStartupTerminalEvidence::Failed(failure_class),
                    )
                }
            };

            if let Err(error) =
                publish_sidecar_startup_status(&app, &thread_control, final_status)
            {
                log::warn!("[cave] {error}");
            }
            finish_sidecar_startup(
                &app,
                &thread_control,
                terminal_policy,
                started.elapsed(),
                terminal_evidence,
            );
        });

    if let Err(error) = spawn_result {
        let message = format!("could not start sidecar preparation worker: {error}");
        finish_sidecar_startup(
            &app,
            &control,
            terminal_policy,
            started.elapsed(),
            NativeStartupTerminalEvidence::Failed(ReliabilityFailureClass::Permissions),
        );
        let _ = publish_sidecar_startup_status(
            &app,
            &control,
            SidecarStartupStatus::failed(message.clone()),
        );
        return Err(message);
    }

    Ok(())
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
pub(super) fn sidecar_startup_status(
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<SidecarStartupStatus, String> {
    state.status()
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
pub(super) fn retry_sidecar_startup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<(), String> {
    spawn_sidecar_startup(
        app,
        Arc::clone(state.inner()),
        NativeStartupTerminalPolicy::RecordAtLifecycleTerminal,
        "sidecar-manual-retry",
        1,
    )
}

#[cfg(all(desktop, target_os = "windows"))]
#[tauri::command]
pub(super) fn cancel_sidecar_startup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SidecarStartupControl>>,
) -> Result<(), String> {
    state.request_cancel()?;
    let mut status = state.status()?;
    status.phase = "cancelling";
    status.message = "Finishing the current operation before cancelling".to_string();
    status.can_cancel = false;
    publish_sidecar_startup_status(&app, state.inner(), status)
}
