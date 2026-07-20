use super::*;

#[cfg(all(desktop, target_os = "windows"))]
pub(super) fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("node")
        .join("bin")
        .join("node.exe")
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub(super) fn bundled_node_path(resource_dir: &Path) -> PathBuf {
    resource_dir
        .join("resources")
        .join("node")
        .join("bin")
        .join("node")
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
        if let Ok(out) = std::process::Command::new("where.exe").arg("node").output() {
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
/// Find the `coven` CLI on disk so API routes spawned from the sidecar can
/// reach it. Same GUI-launch PATH problem as `find_node`. Returns the full
/// path to the binary so callers can prepend its parent directory to PATH.
#[cfg(desktop)]
pub(super) fn find_coven() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let candidates = [
            PathBuf::from(format!("{}\\.volta\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.bun\\bin\\coven.exe", home)),
            PathBuf::from(format!("{}\\.cargo\\bin\\coven.exe", home)),
        ];
        for c in candidates.iter() {
            if c.exists() {
                return Some(c.clone());
            }
        }
        if let Ok(out) = std::process::Command::new("where.exe")
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
                    return Some(pb);
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
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
                    return Some(coven);
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
                return Some(c.clone());
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
                    return Some(pb);
                }
            }
        }
        None
    }
}
