use super::*;

/// Open an http(s) URL in the system default browser.
#[cfg(desktop)]
#[tauri::command]
pub(super) fn shell_open(url: String) -> Result<(), String> {
    validate_shell_open_url(&url)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // Use the Windows URL protocol handler directly instead of routing
        // attacker-controlled URLs through `cmd.exe /c start`, where shell
        // metacharacters such as `&` can execute additional commands.
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open an absolute local directory in the system file explorer.
#[cfg(desktop)]
#[tauri::command]
pub(super) fn shell_open_path(path: String) -> Result<(), String> {
    let path = validate_shell_open_path(&path)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system32_binary("explorer.exe"))
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ask the OS for a local directory and return its absolute path.
#[cfg(desktop)]
#[tauri::command]
pub(super) fn shell_pick_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // `tell app "System Events" ... activate` pulls the picker to the
        // foreground so it isn't summoned behind Cave's window (issue #2614b).
        let output = std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to activate",
                "-e",
                "POSIX path of (choose folder with prompt \"Choose a folder for CovenCave\")",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("-128") || stderr.to_lowercase().contains("user canceled") {
            return Ok(None);
        }
        return Err(stderr.trim().to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // A bare FolderBrowserDialog has no owner window, so Windows opens it
        // *behind* every other window, unfocused, with no taskbar entry — it
        // looks like the click did nothing (issue #2614b). Give it a TopMost,
        // ShowInTaskbar owner form (created off-screen) and pass that form as
        // the ShowDialog owner so the picker is summoned to the foreground.
        let script = r#"Add-Type -AssemblyName System.Windows.Forms; $owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = 'Manual'; $owner.Location = New-Object System.Drawing.Point(-32000, -32000); $owner.Size = New-Object System.Drawing.Size(1, 1); $owner.Show(); $owner.Activate(); $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder for CovenCave'; $result = $d.ShowDialog($owner); $owner.Close(); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }"#;
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Sta", "-Command", script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "folder picker failed".to_string()
            } else {
                stderr
            });
        }
        return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
    }

    #[cfg(target_os = "linux")]
    {
        let zenity = std::process::Command::new("zenity")
            .args([
                "--file-selection",
                "--directory",
                "--modal",
                "--title",
                "Choose a folder for CovenCave",
            ])
            .output();
        if let Ok(output) = zenity {
            if output.status.success() {
                return normalize_picked_directory(&String::from_utf8_lossy(&output.stdout));
            }
            return Ok(None);
        }

        let kdialog = std::process::Command::new("kdialog")
            .args(["--getexistingdirectory"])
            .output()
            .map_err(|_| "No folder picker is available; install zenity or kdialog.".to_string())?;
        if kdialog.status.success() {
            return normalize_picked_directory(&String::from_utf8_lossy(&kdialog.stdout));
        }
        Ok(None)
    }
}
