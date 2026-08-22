use super::*;

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("node")
        .join("bin")
        .join("node.exe")
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn bundled_whisper_cli_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("whisper")
        .join("whisper-cli.exe")
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub(super) fn bundled_whisper_cli_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("whisper")
        .join("whisper-cli")
}

/// Release builds must use the exact whisper.cpp executable staged with the
/// app. This intentionally has no PATH fallback: a missing bundle is a
/// packaging failure, not an invitation to upload audio to a host toolchain.
#[cfg(desktop)]
pub(super) fn find_bundled_whisper_cli(resource_dir: &Path) -> Option<PathBuf> {
    let bundled = bundled_whisper_cli_path(resource_dir);
    bundled.exists().then_some(bundled)
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub(super) fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("node")
        .join("bin")
        .join("node")
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn bundled_piper_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("piper")
        .join("piper.exe")
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub(super) fn bundled_piper_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("piper")
        .join("piper")
}

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn bundled_kokoro_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("kokoro")
        .join("sherpa-onnx-offline-tts.exe")
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub(super) fn bundled_kokoro_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("kokoro")
        .join("sherpa-onnx-offline-tts")
}

/// Find a usable `node` binary. Release builds include a Node runtime under
/// bundled resources so clean user machines can boot the sidecar. Development
/// builds can still fall back to common local Node installs.
#[cfg(desktop)]
pub(super) fn find_node(resource_dir: &Path) -> Option<PathBuf> {
    let bundled = bundled_node_path(resource_dir);
    if bundled.exists() {
        return Some(bundled);
    }

    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();

        // nvm-windows stores versions under %APPDATA%\nvm\v<version>\node.exe
        let nvm_root = PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("nvm");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort(); // lexicographic; good enough for v20 < v24, etc.
            if let Some(latest) = versions.into_iter().next_back() {
                let node = latest.join("node.exe");
                if node.exists() {
                    return Some(node);
                }
            }
        }

        // Standard / tool-manager install locations
        let candidates = [
            PathBuf::from(
                std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into()),
            )
            .join("nodejs")
            .join("node.exe"),
            PathBuf::from(
                std::env::var("ProgramFiles(x86)")
                    .unwrap_or_else(|_| "C:\\Program Files (x86)".into()),
            )
            .join("nodejs")
            .join("node.exe"),
            PathBuf::from(format!("{}\\.volta\\bin\\node.exe", home)),
            PathBuf::from(format!("{}\\.bun\\bin\\node.exe", home)),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }

        // Last ditch: where.exe (Windows equivalent of `which`)
        if let Ok(out) = windows_command::hidden_system32_command("where.exe")
            .arg("node")
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(&path);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }

        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;

        // Prefer nvm — its installs are the most common dev managed-version
        // layout and it tends to lag a step behind the bleeding edge that
        // Homebrew ships, which avoids native-module ABI mismatches with
        // whatever the developer used to build CovenCave's bundled
        // node_modules.
        let nvm_root = PathBuf::from(format!("{}/.nvm/versions/node", home));
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.into_iter().next_back() {
                let node = latest.join("bin").join("node");
                if node.exists() {
                    return Some(node);
                }
            }
        }

        // Other fixed install locations, in order of likelihood
        let candidates = [
            PathBuf::from(format!("{}/.volta/bin/node", home)),
            PathBuf::from(format!("{}/.local/bin/node", home)),
            PathBuf::from(format!("{}/.bun/bin/node", home)),
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }

        // Last ditch: ask a login shell where node lives
        if let Ok(out) = Command::new("/bin/zsh")
            .args(["-lic", "command -v node"])
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(path);
                if pb.exists() {
                    return Some(pb);
                }
            }
        }

        None
    }
}
/// Which lane produced the resolved `coven`. Startup logs this alongside the
/// path: `using coven at <path>` on its own cannot tell an operator whether
/// their `COVEN_BIN` override was honored, which is the line people read while
/// working out which CLI is in play.
#[cfg(desktop)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CovenSource {
    /// `COVEN_BIN` named it explicitly.
    Override,
    /// A known install location matched.
    Candidate,
    /// A PATH lookup (`where.exe`, or a login shell) found it.
    PathLookup,
}

#[cfg(desktop)]
impl CovenSource {
    pub(super) fn label(self) -> &'static str {
        match self {
            CovenSource::Override => "COVEN_BIN override",
            CovenSource::Candidate => "known install location",
            CovenSource::PathLookup => "PATH lookup",
        }
    }
}

/// A resolved `coven` CLI plus the lane that produced it.
#[cfg(desktop)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CovenBinary {
    pub(super) path: PathBuf,
    pub(super) source: CovenSource,
}

/// Why a `COVEN_BIN` value was not usable. Every variant is logged: an
/// explicit override that silently falls through to discovery is what turns a
/// one-line fix into an investigation.
#[cfg(desktop)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OverrideRejection {
    NotAbsolute,
    RemotePath,
    Missing,
    NotAFile,
}

#[cfg(desktop)]
impl OverrideRejection {
    pub(super) fn reason(self) -> &'static str {
        match self {
            // Every arm is interpolated after the word "it" at the single call
            // site below, and mirrors the sentence `covenOverrideRejection`
            // returns on the TS side. This one was missing its verb, so the
            // operator was told "it not an absolute path".
            OverrideRejection::NotAbsolute => "is not an absolute path",
            OverrideRejection::RemotePath => "is not on a local drive",
            OverrideRejection::Missing => "does not exist",
            OverrideRejection::NotAFile => "is not a file",
        }
    }
}

/// What a filesystem probe found. Split out so the verification rules can be
/// exercised on any host, including the Linux runner that runs `cargo test`.
#[cfg(desktop)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PathProbe {
    Missing,
    NotAFile,
    /// `canonical` is the symlink-resolved path, which is what the remote-share
    /// check must run against — the literal path can be a local symlink whose
    /// target sits on a share.
    File { canonical: String },
}

/// Mirror of `isWindowsRemoteExecutablePath` in
/// `src/lib/windows-local-path.ts`: a Cave-owned local CLI must not be sourced
/// from another machine. Besides crossing the local trust boundary, probing one
/// can stall on an offline share.
///
/// This is an allowlist, and it has to be. The denylist it replaces refused
/// `\\host\` and `\\?\UNC\` and admitted five spellings that were measured
/// reaching another machine on Windows 11 — `fs` read
/// `\\localhost\C$\Windows\win.ini` through each of them:
///
///     \\.\UNC\host\share\coven.exe
///     \\?\GLOBALROOT\Device\Mup\host\share\coven.exe
///     \\?\GLOBALROOT\Device\LanmanRedirector\host\share\coven.exe
///     \\?\GLOBALROOT\??\UNC\host\share\coven.exe
///     \\.\C:\..\..\UNC\host\share\coven.exe
///
/// The last two show the set does not close by enumeration: `GLOBALROOT` re-
/// enters the object-manager root so remote routes nest arbitrarily, and a `..`
/// pops whichever component was allowed and lands back at the device root.
///
/// So: a path not rooted at `\\` cannot leave the machine by spelling alone. A
/// path rooted at `\\` is eligible only as a drive letter behind a device
/// prefix (`\\?\C:\`, `\\.\C:\`) with no `..` component. The pipe device is
/// local but is not a place a launcher lives, so it is refused here even though
/// the daemon-socket boundary admits it.
#[cfg(desktop)]
pub(super) fn is_windows_remote_executable_path(candidate: &str) -> bool {
    let normalized: String = candidate
        .trim()
        .chars()
        .map(|c| if c == '/' { '\\' } else { c })
        .collect();
    let Some(rest) = normalized.strip_prefix("\\\\") else {
        return false;
    };
    if normalized.split('\\').any(|segment| segment == "..") {
        return true;
    }
    let Some(after_prefix) = rest
        .strip_prefix('?')
        .or_else(|| rest.strip_prefix('.'))
        .and_then(|tail| tail.strip_prefix('\\'))
    else {
        return true;
    };
    let bytes = after_prefix.as_bytes();
    !(bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'\\')
}

/// Host-independent `path.isAbsolute`. `Path::is_absolute` answers for the
/// compile target only, which would make the Windows rules untestable on the
/// Linux runner.
#[cfg(desktop)]
pub(super) fn is_absolute_binary_path(candidate: &str, windows: bool) -> bool {
    if !windows {
        return candidate.starts_with('/');
    }
    let normalized: String = candidate
        .chars()
        .map(|c| if c == '/' { '\\' } else { c })
        .collect();
    if normalized.starts_with('\\') {
        return true;
    }
    let bytes = normalized.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
}

/// Apply the same admission rules to `COVEN_BIN` that `verifiedAbsoluteBinary`
/// applies on the TS side: absolute, existing, a file, and on Windows never a
/// path that fails to prove it is on a local drive — see
/// `is_windows_remote_executable_path`, which is an allowlist rather than a
/// `UNC` denylist.
///
/// One deliberate difference from the TS resolver: the *literal* path is
/// returned, not the canonical one. The result here is not executed directly —
/// its parent directory is prepended to a PATH string — and Windows'
/// `canonicalize` yields a `\\?\`-prefixed path that PATH search does not
/// honor. The canonical form is still what the remote-share check runs
/// against, so a symlink pointing at a share is rejected either way.
#[cfg(desktop)]
pub(super) fn verify_coven_override(
    candidate: &str,
    windows: bool,
    probe: impl Fn(&str) -> PathProbe,
) -> Result<String, OverrideRejection> {
    if !is_absolute_binary_path(candidate, windows) {
        return Err(OverrideRejection::NotAbsolute);
    }
    if windows && is_windows_remote_executable_path(candidate) {
        return Err(OverrideRejection::RemotePath);
    }
    match probe(candidate) {
        PathProbe::Missing => Err(OverrideRejection::Missing),
        PathProbe::NotAFile => Err(OverrideRejection::NotAFile),
        PathProbe::File { canonical } => {
            if windows && is_windows_remote_executable_path(&canonical) {
                return Err(OverrideRejection::RemotePath);
            }
            Ok(candidate.to_string())
        }
    }
}

#[cfg(desktop)]
fn probe_filesystem(candidate: &str) -> PathProbe {
    let path = Path::new(candidate);
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let canonical = std::fs::canonicalize(path)
                .map(|resolved| resolved.to_string_lossy().into_owned())
                .unwrap_or_else(|_| candidate.to_string());
            PathProbe::File { canonical }
        }
        Ok(_) => PathProbe::NotAFile,
        Err(_) => PathProbe::Missing,
    }
}

/// Explicit override always wins, matching `covenBinaryFromEnvironment` and
/// `covenBin` in `src/lib/coven-bin.ts`. Useful for local dev when a
/// checkout-built CLI is newer than the npm-bundled one — which is the only
/// way to reach a checkout build at all, since no candidate list names one.
///
/// `std::env::var` is already case-insensitive on Windows, so this matches the
/// TS `environmentValue` lookup without a separate scan.
#[cfg(desktop)]
fn coven_override() -> Option<CovenBinary> {
    let raw = std::env::var("COVEN_BIN").ok()?;
    let candidate = raw.trim();
    if candidate.is_empty() {
        return None;
    }
    match verify_coven_override(candidate, cfg!(target_os = "windows"), probe_filesystem) {
        Ok(path) => Some(CovenBinary {
            path: PathBuf::from(path),
            source: CovenSource::Override,
        }),
        Err(rejection) => {
            log::warn!(
                "[cave] ignoring COVEN_BIN={} - it {}; falling back to discovery",
                candidate,
                rejection.reason()
            );
            None
        }
    }
}

/// Root of Cave's own managed toolchain, mirroring `managedNodeRoot` in
/// `src/lib/server/managed-node-toolchain.ts`. The TS resolver ranks this lane
/// first; without it here the shell and the sidecar can disagree about which
/// `coven` is canonical, with no diagnostic saying so.
#[cfg(desktop)]
fn managed_toolchain_root() -> Option<PathBuf> {
    fn non_empty(key: &str) -> Option<String> {
        std::env::var(key).ok().filter(|value| !value.is_empty())
    }

    #[cfg(target_os = "windows")]
    {
        let local = non_empty("LOCALAPPDATA").map(PathBuf::from).or_else(|| {
            non_empty("USERPROFILE").map(|home| PathBuf::from(home).join("AppData").join("Local"))
        })?;
        Some(local.join("OpenCoven").join("CovenCave").join("toolchains"))
    }

    #[cfg(target_os = "macos")]
    {
        let home = non_empty("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("OpenCoven")
                .join("CovenCave")
                .join("toolchains"),
        )
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let data = non_empty("XDG_DATA_HOME").map(PathBuf::from).or_else(|| {
            non_empty("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })?;
        Some(data.join("opencoven").join("coven-cave").join("toolchains"))
    }
}

/// npm installs the Coven CLI into the managed prefix: a `.cmd` shim beside the
/// prefix root on Windows, a `bin/` entry elsewhere.
#[cfg(desktop)]
fn managed_coven_candidates() -> Vec<PathBuf> {
    let Some(root) = managed_toolchain_root() else {
        return Vec::new();
    };
    let npm = root.join("npm");
    #[cfg(target_os = "windows")]
    {
        vec![npm.join("coven.cmd"), npm.join("coven.exe")]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![npm.join("bin").join("coven")]
    }
}

/// Find the `coven` CLI on disk so API routes spawned from the sidecar can
/// reach it. Same GUI-launch PATH problem as `find_node`. Returns the full
/// path to the binary so callers can prepend its parent directory to PATH,
/// plus the lane that produced it so startup can log which one won.
#[cfg(desktop)]
pub(super) fn find_coven() -> Option<CovenBinary> {
    if let Some(binary) = coven_override() {
        return Some(binary);
    }
    find_coven_by_discovery()
}

#[cfg(desktop)]
fn find_coven_by_discovery() -> Option<CovenBinary> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        // npm global installs land in %APPDATA%\\npm as a .cmd shim (not .exe),
        // which is the most common way users install the Coven CLI. A GUI-launched
        // Tauri app frequently does not inherit that dir on PATH, so we must probe
        // it explicitly or `where.exe` below will miss it. Fall back to
        // %USERPROFILE%\\AppData\\Roaming\\npm when APPDATA is unset.
        let appdata = std::env::var("APPDATA")
            .unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home));
        // Cave's managed toolchain leads, as it does in `candidateDirs()` on the
        // TS side: a Cave-installed CLI is preferred over a stale host binary.
        let mut candidates = managed_coven_candidates();
        candidates.extend([
            PathBuf::from(format!("{}\\npm\\coven.cmd", appdata)),
            PathBuf::from(format!("{}\\npm\\coven.exe", appdata)),
            PathBuf::from(format!("{}\\.volta\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.bun\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.cargo\\bin\\coven.exe", home)),
        ]);
        for c in candidates.iter() {
            if c.exists() {
                return Some(CovenBinary {
                    path: c.clone(),
                    source: CovenSource::Candidate,
                });
            }
        }
        if let Ok(out) = windows_command::hidden_system32_command("where.exe")
            .arg("coven")
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(&path);
                if pb.exists() {
                    return Some(CovenBinary {
                        path: pb,
                        source: CovenSource::PathLookup,
                    });
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Cave's managed toolchain leads, as it does in `candidateDirs()` on the
        // TS side: a Cave-installed CLI is preferred over a stale host binary.
        for c in managed_coven_candidates() {
            if c.exists() {
                return Some(CovenBinary {
                    path: c,
                    source: CovenSource::Candidate,
                });
            }
        }

        let home = std::env::var("HOME").ok()?;
        let nvm_root = PathBuf::from(format!("{}/.nvm/versions/node", home));
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.into_iter().next_back() {
                let coven = latest.join("bin").join("coven");
                if coven.exists() {
                    return Some(CovenBinary {
                        path: coven,
                        source: CovenSource::Candidate,
                    });
                }
            }
        }

        let candidates = [
            PathBuf::from(format!("{}/.bun/bin/coven", home)),
            PathBuf::from("/opt/homebrew/bin/coven"),
            PathBuf::from("/usr/local/bin/coven"),
            PathBuf::from(format!("{}/.local/bin/coven", home)),
            // ~/.cargo/bin often holds an older Rust-installed Coven CLI.
            PathBuf::from(format!("{}/.cargo/bin/coven", home)),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(CovenBinary {
                    path: c.clone(),
                    source: CovenSource::Candidate,
                });
            }
        }
        if let Ok(out) = Command::new("/bin/zsh")
            .args(["-lic", "command -v coven"])
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                let pb = PathBuf::from(path);
                if pb.exists() {
                    return Some(CovenBinary {
                        path: pb,
                        source: CovenSource::PathLookup,
                    });
                }
            }
        }
        None
    }
}

#[cfg(all(test, desktop))]
mod coven_binary_tests {
    use super::*;

    fn file_probe(canonical: &str) -> impl Fn(&str) -> PathProbe + '_ {
        move |_| PathProbe::File {
            canonical: canonical.to_string(),
        }
    }

    #[test]
    fn absolute_paths_are_recognized_per_host() {
        assert!(is_absolute_binary_path("/usr/local/bin/coven", false));
        assert!(!is_absolute_binary_path("bin/coven", false));
        assert!(!is_absolute_binary_path("C:\\bin\\coven.exe", false));

        assert!(is_absolute_binary_path("C:\\bin\\coven.exe", true));
        assert!(is_absolute_binary_path("c:/bin/coven.exe", true));
        assert!(is_absolute_binary_path(
            "\\\\server\\share\\coven.exe",
            true
        ));
        assert!(!is_absolute_binary_path("bin\\coven.exe", true));
        assert!(!is_absolute_binary_path("C:coven.exe", true));
    }

    #[test]
    fn remote_share_paths_are_detected_in_both_spellings() {
        assert!(is_windows_remote_executable_path(
            "\\\\server\\share\\coven.exe"
        ));
        assert!(is_windows_remote_executable_path(
            "//server/share/coven.exe"
        ));
        assert!(is_windows_remote_executable_path(
            "\\\\?\\UNC\\server\\share\\coven.exe"
        ));
        assert!(is_windows_remote_executable_path(
            "\\\\?\\unc\\server\\share\\coven.exe"
        ));
        // Only a drive letter behind a device prefix is admitted, and only
        // without a `..`.
        assert!(!is_windows_remote_executable_path(
            "\\\\?\\C:\\bin\\coven.exe"
        ));
        assert!(!is_windows_remote_executable_path(
            "\\\\.\\C:\\bin\\coven.exe"
        ));
        assert!(!is_windows_remote_executable_path("C:\\bin\\coven.exe"));
        assert!(!is_windows_remote_executable_path("coven.exe"));
    }

    /// Spellings the two-regex denylist admitted. Each of the first six was
    /// measured on Windows 11 reading `\\localhost\C$\Windows\win.ini` with
    /// the host spelled `localhost`, so each is a live redirection and not a
    /// theoretical shape. The last two are the same routes re-spelled — with
    /// forward slashes, and with the surrounding whitespace an environment
    /// variable carries — which the predicate folds away before deciding.
    #[test]
    fn device_namespace_spellings_that_reach_another_machine_are_refused() {
        for admitted in [
            "\\\\.\\UNC\\server\\share\\coven.exe",
            "\\\\?\\GLOBALROOT\\Device\\Mup\\server\\share\\coven.exe",
            "\\\\?\\GLOBALROOT\\Device\\LanmanRedirector\\server\\share\\coven.exe",
            "\\\\?\\GLOBALROOT\\??\\UNC\\server\\share\\coven.exe",
            "\\\\.\\C:\\..\\..\\UNC\\server\\share\\coven.exe",
            // `\\?\` does not make a `..` inert for a file path, whatever it
            // does for a pipe name: this one read the remote file too.
            "\\\\?\\C:\\..\\..\\UNC\\server\\share\\coven.exe",
            "//./UNC/server/share/coven.exe",
            "  \\\\server\\share\\coven.exe  ",
        ] {
            assert!(
                is_windows_remote_executable_path(admitted),
                "{admitted} reaches another machine and must not be eligible"
            );
        }
        // The pipe device stays on this machine, but no launcher lives there,
        // so the executable boundary is tighter than the daemon-socket one.
        assert!(is_windows_remote_executable_path("\\\\.\\pipe\\coven"));
    }

    #[test]
    fn a_relative_override_is_rejected_rather_than_resolved_against_the_cwd() {
        // Windows searches the child cwd before PATH, so a relative override is
        // exactly the value a planted launcher would need.
        assert_eq!(
            verify_coven_override("coven.exe", true, file_probe("C:\\work\\coven.exe")),
            Err(OverrideRejection::NotAbsolute)
        );
    }

    #[test]
    fn a_remote_override_is_rejected_before_the_filesystem_is_touched() {
        let probe = |_: &str| -> PathProbe {
            panic!("an offline share must not be probed");
        };
        assert_eq!(
            verify_coven_override("\\\\server\\share\\coven.exe", true, probe),
            Err(OverrideRejection::RemotePath)
        );
    }

    #[test]
    fn a_local_symlink_onto_a_share_is_rejected_by_its_canonical_target() {
        assert_eq!(
            verify_coven_override(
                "C:\\links\\coven.exe",
                true,
                file_probe("\\\\?\\UNC\\server\\share\\coven.exe"),
            ),
            Err(OverrideRejection::RemotePath)
        );
    }

    #[test]
    fn missing_and_non_file_overrides_report_distinct_reasons() {
        assert_eq!(
            verify_coven_override("/opt/coven/bin/coven", false, |_| PathProbe::Missing),
            Err(OverrideRejection::Missing)
        );
        assert_eq!(
            verify_coven_override("/opt/coven/bin", false, |_| PathProbe::NotAFile),
            Err(OverrideRejection::NotAFile)
        );
        // Each reason reaches the log with its own wording; a bare "ignored"
        // would not tell an operator which part of the value to fix.
        assert_ne!(
            OverrideRejection::Missing.reason(),
            OverrideRejection::NotAFile.reason()
        );
    }

    #[test]
    fn a_verified_override_keeps_the_literal_path_not_the_canonical_one() {
        // The parent directory is prepended to a PATH string, and Windows PATH
        // search does not honor the `\\?\` prefix `canonicalize` produces.
        assert_eq!(
            verify_coven_override(
                "C:\\checkout\\target\\release\\coven.exe",
                true,
                file_probe("\\\\?\\C:\\checkout\\target\\release\\coven.exe"),
            ),
            Ok("C:\\checkout\\target\\release\\coven.exe".to_string())
        );
    }

    #[test]
    fn sources_are_labeled_distinctly_for_the_startup_log() {
        let labels = [
            CovenSource::Override.label(),
            CovenSource::Candidate.label(),
            CovenSource::PathLookup.label(),
        ];
        for (index, label) in labels.iter().enumerate() {
            assert!(!label.is_empty());
            assert!(
                !labels[index + 1..].contains(label),
                "each lane must be distinguishable in the log"
            );
        }
    }

    #[test]
    fn the_managed_toolchain_lane_leads_discovery() {
        // The TS resolver ranks its managed lane first; the Rust list had no
        // entry for it at all, so the shell and the sidecar could disagree
        // about which `coven` is canonical.
        let managed = managed_coven_candidates();
        assert!(
            !managed.is_empty(),
            "the managed toolchain lane must contribute at least one candidate"
        );
        for candidate in managed {
            assert!(
                candidate.to_string_lossy().contains("toolchains"),
                "managed candidates live under the managed toolchain root"
            );
            assert!(
                candidate.ends_with("coven")
                    || candidate.ends_with("coven.cmd")
                    || candidate.ends_with("coven.exe")
            );
        }
    }
}
