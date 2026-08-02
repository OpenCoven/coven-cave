use super::*;

#[cfg(desktop)]
fn spawn_x_oauth_browser_launcher(url: &str) -> std::io::Result<std::process::Child> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new(windows_system32_binary("rundll32.exe"));
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
}

#[cfg(desktop)]
pub(super) fn launch_x_oauth_url_with_window<F>(
    url: &str,
    launch_window: std::time::Duration,
    spawner: F,
) -> Result<(), String>
where
    F: FnOnce(&str) -> std::io::Result<std::process::Child>,
{
    validate_x_oauth_url(url)?;

    // Start the waiter first so every successfully spawned opener is handed to
    // a thread that owns it through wait(), even after launch detection times out.
    let (child_sender, child_receiver) = std::sync::mpsc::sync_channel::<std::process::Child>(1);
    let (status_sender, status_receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("x-oauth-launcher-reaper".to_string())
        .spawn(move || {
            let Ok(mut child) = child_receiver.recv() else {
                return;
            };
            let status = child.wait();
            let _ = status_sender.send(status);
        })
        .map_err(|_| "Could not start the system browser launcher.".to_string())?;

    let child =
        spawner(url).map_err(|_| "Could not start the system browser launcher.".to_string())?;
    if let Err(send_error) = child_sender.send(child) {
        let mut child = send_error.0;
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not start the system browser launcher.".to_string());
    }

    match status_receiver.recv_timeout(launch_window) {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(_)) => Err("System browser launcher exited unsuccessfully.".to_string()),
        Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("Could not start the system browser launcher.".to_string())
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Ok(()),
    }
}

#[cfg(desktop)]
pub(super) fn launch_x_oauth_url_with<F>(url: &str, spawner: F) -> Result<(), String>
where
    F: FnOnce(&str) -> std::io::Result<std::process::Child>,
{
    launch_x_oauth_url_with_window(url, std::time::Duration::from_millis(250), spawner)
}

/// Open only a complete X OAuth authorization URL in the system browser.
#[cfg(desktop)]
#[tauri::command]
pub(super) async fn open_x_oauth_url(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        launch_x_oauth_url_with(&url, spawn_x_oauth_browser_launcher)
    })
    .await
    .map_err(|_| "System browser launcher task did not complete.".to_string())?
}

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
                "POSIX path of (choose folder with prompt \"Choose a folder for CovenCave\" invisibles true)",
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
        // Windows PowerShell's .NET Framework FolderBrowserDialog cannot force
        // hidden items visible, so use IFileOpenDialog with FOS_FORCESHOWHIDDEN.
        // Give it a TopMost, off-screen owner form so the picker is summoned to
        // the foreground instead of opening behind Cave (issue #2614b).
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
internal class FileOpenDialogCom {}

[ComImport]
[Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileDialog
{
    [PreserveSig]
    int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr filterSpec);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
}

[ComImport]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellItem
{
    void BindToHandler(IntPtr bindingContext, ref Guid handler, ref Guid interfaceId, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint displayName, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem item, uint hint, out int order);
}

public static class CovenFolderPicker
{
    private const uint FOS_PICKFOLDERS = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM = 0x00000040;
    private const uint FOS_FORCESHOWHIDDEN = 0x10000000;
    private const uint SIGDN_FILESYSPATH = 0x80058000;
    private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

    public static string Pick(IntPtr owner)
    {
        IFileDialog dialog = null;
        IShellItem item = null;
        IntPtr path = IntPtr.Zero;
        try
        {
            dialog = (IFileDialog)new FileOpenDialogCom();
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_FORCESHOWHIDDEN);
            dialog.SetTitle("Choose a folder for CovenCave");

            int result = dialog.Show(owner);
            if (result == ERROR_CANCELLED) return null;
            Marshal.ThrowExceptionForHR(result);

            dialog.GetResult(out item);
            item.GetDisplayName(SIGDN_FILESYSPATH, out path);
            return Marshal.PtrToStringUni(path);
        }
        finally
        {
            if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
            if (item != null) Marshal.FinalReleaseComObject(item);
            if (dialog != null) Marshal.FinalReleaseComObject(dialog);
        }
    }
}
'@

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$owner.Activate()
try {
    $selected = [CovenFolderPicker]::Pick($owner.Handle)
    if ($null -ne $selected) { [Console]::Write($selected) }
} finally {
    $owner.Close()
}
"#;
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
                "--show-hidden",
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
