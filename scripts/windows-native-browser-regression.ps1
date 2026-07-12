#requires -Version 5.1

<#
.SYNOPSIS
Exercises CovenCave's native Windows Browser surface and authoritative close path.

.DESCRIPTION
This harness launches one exact candidate executable, or attaches to one exact PID
whose executable path matches -Executable. Launches receive a unique WebView2 user
data directory and CDP port. The harness never installs, upgrades, uninstalls, or
force-terminates anything. A failed close is reported and left for the operator.

Settings links and shell controls are clicked through user32 mouse input. CDP is
used only to locate the main DOM, read geometry/state, and create finite JavaScript
stalls for the close probe. Native Browser overlays are verified by enumerating
direct WRY_WEBVIEW children of the main HWND.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-native-browser-regression.ps1 `
  -Executable C:\candidate\app.exe -Cycles 12 -ExpectPackagedSidecar

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-native-browser-regression.ps1 `
  -Executable C:\candidate\app.exe -AttachPid 1234 -CdpPort 9225 -SkipClose

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-native-browser-regression.ps1 `
  -Executable C:\candidate\app.exe -AttachPid 1234 -CdpPort 9225 -DryRun

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-native-browser-regression.ps1 `
  -Executable C:\candidate\app.exe -StartupProbeOnly -Cycles 0
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,

    [ValidateRange(0, 2147483647)]
    [int]$AttachPid = 0,

    [ValidateRange(0, 65535)]
    [int]$CdpPort = 0,

    [string]$WebView2Profile,

    [ValidateSet("Passive", "FocusOnly", "AsyncResizeOnly", "LegacyFullPrep")]
    [string]$PreparationMode = "Passive",

    [ValidateRange(0, 600)]
    [int]$Cycles = 12,

    [ValidateRange(500, 30000)]
    [int]$CloseDeadlineMs = 2000,

    [ValidateRange(500, 30000)]
    [int]$PostExitDeadlineMs = 5000,

    [ValidateRange(2000, 30000)]
    [int]$RendererStallMs = 8000,

    [ValidateRange(0, 500)]
    [int]$TransitionDelayMs = 35,

    [ValidateRange(1, 20)]
    [int]$BoundsTolerancePx = 4,

    [ValidateRange(0, 1)]
    [int]$ClientContainmentTolerancePx = 1,

    [switch]$ExpectPackagedSidecar,
    [switch]$ExpectPtyDescendant,
    [switch]$StartTrustedPty,
    [string]$PtyProjectRoot,
    [switch]$PartialCoverage,
    [switch]$SkipClose,
    [switch]$AllowCloseAttached,
    [switch]$StartupProbeOnly,
    [switch]$DryRun,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "windows-native-browser-regression.ps1 requires Windows."
}
if ($AttachPid -gt 0 -and -not $SkipClose -and -not $StartupProbeOnly -and -not $DryRun -and -not $AllowCloseAttached) {
    throw "Attach mode never closes an existing app unless -AllowCloseAttached is explicit. Use -SkipClose for non-closing checks."
}
if ($RendererStallMs -le $CloseDeadlineMs) {
    throw "-RendererStallMs must exceed -CloseDeadlineMs so native close is proven independent of JavaScript."
}
if (-not $StartupProbeOnly -and -not $PartialCoverage -and $Cycles -lt 12) {
    throw "Full regression mode requires at least 12 cycles so every Settings link is proven twice. Use -PartialCoverage for an explicit diagnostic run."
}
if ($StartupProbeOnly -and $StartTrustedPty) {
    throw "-StartupProbeOnly is observation-only and cannot be combined with -StartTrustedPty."
}

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
}

function Test-PathEqual {
    param([string]$Left, [string]$Right)
    if (-not $Left -or -not $Right) { return $false }
    return (Get-FullPath $Left).Equals((Get-FullPath $Right), [StringComparison]::OrdinalIgnoreCase)
}

$candidatePath = Get-FullPath $Executable
if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
    throw "Candidate executable does not exist: $candidatePath"
}
if ([System.IO.Path]::GetExtension($candidatePath) -ine ".exe") {
    throw "Candidate must be an exact .exe path; MSI/install inputs are intentionally unsupported."
}

if (-not $OutputPath) {
    $OutputPath = Join-Path ([System.IO.Path]::GetTempPath()) (
        "coven-native-browser-regression-{0}.json" -f [Guid]::NewGuid().ToString("N")
    )
}
$OutputPath = Get-FullPath $OutputPath

$settingsLinks = @(
    [ordered]@{ label = "GitHub"; href = "https://github.com/OpenCoven/coven-cave" },
    [ordered]@{ label = "Docs"; href = "https://docs.opencoven.ai" },
    [ordered]@{ label = "X"; href = "https://x.com/OpenCvn" },
    [ordered]@{ label = "Discord"; href = "https://discord.gg/opencoven" },
    [ordered]@{ label = "Grimoire"; href = "https://mind.opencoven.ai" },
    [ordered]@{ label = "Podcast"; href = "https://pod.opencoven.ai" }
)

$childUrlRules = [ordered]@{
    GitHub = @([ordered]@{ host = "github.com"; pathPrefix = "/OpenCoven/coven-cave"; queryContains = $null })
    Docs = @([ordered]@{ host = "docs.opencoven.ai"; pathPrefix = "/"; queryContains = $null })
    X = @(
        [ordered]@{ host = "x.com"; pathPrefix = "/OpenCvn"; queryContains = $null },
        [ordered]@{ host = "x.com"; pathPrefix = "/i/flow/login"; queryContains = "redirect_after_login" }
    )
    Discord = @(
        [ordered]@{ host = "discord.gg"; pathPrefix = "/opencoven"; queryContains = $null },
        [ordered]@{ host = "discord.com"; pathPrefix = "/invite/opencoven"; queryContains = $null }
    )
    Grimoire = @([ordered]@{ host = "mind.opencoven.ai"; pathPrefix = "/"; queryContains = $null })
    Podcast = @([ordered]@{ host = "pod.opencoven.ai"; pathPrefix = "/"; queryContains = $null })
}

$linkCoverageByLabel = @{}
$linkCoverage = @($settingsLinks | ForEach-Object {
    $entry = [ordered]@{
        label = [string]$_.label
        href = [string]$_.href
        requiredPasses = if ($PartialCoverage -or $StartupProbeOnly) { 0 } else { 2 }
        attempts = 0
        passes = 0
        actualUrls = @()
    }
    $linkCoverageByLabel[[string]$_.label] = $entry
    $entry
})

$profileOwnerToken = [Guid]::NewGuid().ToString("N")
$profileMarkerContent = "coven-native-regression-owner-v1`n$profileOwnerToken`n$OutputPath"

$reportWatch = [Diagnostics.Stopwatch]::StartNew()
$report = [ordered]@{
    schemaVersion = 2
    startedAtUtc = [DateTime]::UtcNow.ToString("o")
    status = "starting"
    mode = if ($AttachPid -gt 0) { "attach" } else { "launch" }
    candidate = [ordered]@{ path = $candidatePath; processId = $null; creationTimeUtc = $null }
    isolation = [ordered]@{
        cdpPort = $CdpPort
        webView2Profile = $WebView2Profile
        profileCreatedByHarness = $false
        profileOwnerToken = $profileOwnerToken
        profileCleanup = [ordered]@{ eligible = $false; attempted = $false; passed = $null; error = $null }
        dpiAwareness = $null
        dpiAwarenessRestored = $null
    }
    preparation = [ordered]@{
        mode = $PreparationMode
        startupProbeOnly = [bool]$StartupProbeOnly
        partialCoverage = [bool]$PartialCoverage
    }
    settingsLinks = $settingsLinks
    childUrlRedirectAllowances = $childUrlRules
    linkCoverage = $linkCoverage
    cyclesRequested = $Cycles
    cyclesCompleted = 0
    transitions = @()
    phases = @()
    startupGeometry = $null
    geometryTolerances = [ordered]@{ viewportPixels = $BoundsTolerancePx; clientContainmentPixels = $ClientContainmentTolerancePx }
    lastPhysicalInput = $null
    processSnapshot = @()
    ptySetup = [ordered]@{ requested = [bool]$StartTrustedPty; threadId = $null; projectRoot = $null; started = $false; newExactTuple = $null }
    stalls = @()
    close = [ordered]@{ skipped = [bool]($SkipClose -or $StartupProbeOnly); posted = $false; elapsedMilliseconds = $null; withinDeadline = $null }
    orphanCheck = [ordered]@{ performed = $false; passed = $null; survivingTuples = @() }
    safety = [ordered]@{
        exactExecutableRequired = $true
        attachedCloseRequiresExplicitOptIn = $true
        installedAppMutationInvoked = $false
        msiMutationInvoked = $false
        unrelatedProcessTerminationInvoked = $false
        forcedTerminationInvoked = $false
    }
    outputPath = $OutputPath
    failure = $null
}

function Write-RegressionReport {
    $parent = Split-Path -Parent $OutputPath
    if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
    [System.IO.File]::WriteAllText(
        $OutputPath,
        ($report | ConvertTo-Json -Depth 20),
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Get-FreeLoopbackPort {
    foreach ($candidate in 9222..9322) {
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
            $listener.Start()
            return $candidate
        }
        catch { }
        finally { if ($null -ne $listener) { $listener.Stop() } }
    }
    throw "No free loopback CDP port was found in 9222..9322."
}

function Test-LoopbackPortListening {
    param([int]$Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync("127.0.0.1", $Port)
        return $task.Wait(150) -and $client.Connected
    }
    catch { return $false }
    finally { $client.Dispose() }
}

if ($AttachPid -eq 0) {
    if ($CdpPort -eq 0) { $CdpPort = Get-FreeLoopbackPort }
    elseif (Test-LoopbackPortListening $CdpPort) { throw "CDP port $CdpPort is already in use; launch isolation requires a free port." }

    if (-not $WebView2Profile) {
        $WebView2Profile = Join-Path ([System.IO.Path]::GetTempPath()) (
            "covencave-webview2-regression-{0}" -f [Guid]::NewGuid().ToString("N")
        )
    }
    $WebView2Profile = Get-FullPath $WebView2Profile
    $launchTempRoot = (Get-FullPath ([System.IO.Path]::GetTempPath())).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $launchTempBoundary = $launchTempRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $WebView2Profile.StartsWith($launchTempBoundary, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Launch profile must be a strict child of the Windows temp directory: $WebView2Profile"
    }
    if (Test-Path -LiteralPath $WebView2Profile) {
        throw "Launch profile must not already exist; the harness only cleans directories it created: $WebView2Profile"
    }
}
elseif ($CdpPort -eq 0 -and -not $DryRun) {
    throw "Attach mode requires the exact candidate's existing -CdpPort."
}

$report.isolation.cdpPort = $CdpPort
$report.isolation.webView2Profile = $WebView2Profile

function ConvertTo-CreationUtc {
    param($Value)
    if ($Value -is [DateTime]) { return ([DateTime]$Value).ToUniversalTime() }
    return [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$Value).ToUniversalTime()
}

function Get-ProcessCimExact {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    if ($rows.Count -eq 0) { return $null }
    return $rows[0]
}

function Get-ProcessKind {
    param([string]$Name, [string]$Path, [bool]$IsRoot)
    if ($IsRoot) { return "app" }
    if ($Name -ieq "msedgewebview2.exe") { return "webview2" }
    if ($Name -ieq "node.exe") { return "node" }
    if ($Name -in @("conhost.exe", "OpenConsole.exe", "winpty-agent.exe", "cmd.exe", "powershell.exe", "pwsh.exe")) { return "pty" }
    if ($Name -in @("app.exe", "CovenCave.exe") -or ($Path -and $Path.StartsWith((Split-Path -Parent $candidatePath), [StringComparison]::OrdinalIgnoreCase))) { return "coven" }
    return "owned-descendant"
}

function ConvertTo-ProcessTuple {
    param($Process, [int]$RootProcessId)
    if ($null -eq $Process.CreationDate) { throw "PID $($Process.ProcessId) has no creation time; exact tuple attribution is unavailable." }
    $created = ConvertTo-CreationUtc $Process.CreationDate
    $path = if ($Process.ExecutablePath) { [string]$Process.ExecutablePath } else { $null }
    return [pscustomobject][ordered]@{
        processId = [int]$Process.ProcessId
        parentProcessId = [int]$Process.ParentProcessId
        creationTimeUtc = $created.ToString("o")
        creationTimeUtcTicks = [long]$created.Ticks
        name = [string]$Process.Name
        executablePath = $path
        kind = Get-ProcessKind -Name ([string]$Process.Name) -Path $path -IsRoot ([int]$Process.ProcessId -eq $RootProcessId)
    }
}

function Get-OwnedProcessTuples {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)
    $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $byParent = @{}
    foreach ($item in $all) {
        $key = [string][int]$item.ParentProcessId
        if (-not $byParent.ContainsKey($key)) { $byParent[$key] = New-Object System.Collections.ArrayList }
        [void]$byParent[$key].Add($item)
    }
    $root = @($all | Where-Object { [int]$_.ProcessId -eq $RootProcessId } | Select-Object -First 1)
    if ($root.Count -eq 0) { return @() }
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($root[0])
    $seen = @{}
    $result = @()
    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        $id = [int]$item.ProcessId
        if ($seen.ContainsKey([string]$id)) { continue }
        $seen[[string]$id] = $true
        $result += ConvertTo-ProcessTuple -Process $item -RootProcessId $RootProcessId
        $key = [string]$id
        if ($byParent.ContainsKey($key)) {
            foreach ($child in $byParent[$key]) { $queue.Enqueue($child) }
        }
    }
    return @($result)
}

function Get-TupleKey {
    param($Tuple)
    return "{0}|{1}" -f [int]$Tuple.processId, [long]$Tuple.creationTimeUtcTicks
}

function Test-ProcessTupleAlive {
    param($Tuple)
    $current = Get-ProcessCimExact -ProcessId ([int]$Tuple.processId)
    if ($null -eq $current -or $null -eq $current.CreationDate) { return $false }
    $created = ConvertTo-CreationUtc $current.CreationDate
    return [long]$created.Ticks -eq [long]$Tuple.creationTimeUtcTicks
}

function Get-AttributedProcessTuples {
    param(
        [Parameter(Mandatory = $true)][int]$RootProcessId,
        $ExactRootTuple,
        [string]$UniqueWebViewProfile
    )
    $byKey = @{}
    foreach ($tuple in @(Get-OwnedProcessTuples -RootProcessId $RootProcessId)) {
        if ([int]$tuple.processId -eq $RootProcessId) {
            if ($null -eq $ExactRootTuple -or
                (Get-TupleKey $tuple) -ne (Get-TupleKey $ExactRootTuple) -or
                -not (Test-PathEqual ([string]$tuple.executablePath) ([string]$ExactRootTuple.executablePath))) {
                continue
            }
        }
        $byKey[(Get-TupleKey $tuple)] = $tuple
    }

    # WebView2 descendants can detach/reparent during shutdown. The per-run
    # profile is a stronger identity than the live parent tree, so retain every
    # exact PID+creation tuple whose command line names that unique directory.
    if ($UniqueWebViewProfile) {
        foreach ($row in @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue)) {
            $commandLine = [string]$row.CommandLine
            if ($commandLine.IndexOf($UniqueWebViewProfile, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            $tuple = ConvertTo-ProcessTuple -Process $row -RootProcessId $RootProcessId
            $byKey[(Get-TupleKey $tuple)] = $tuple
        }
    }

    # Include the authoritative root only when both PID+creation and executable
    # path still match. PID reuse must never make an unrelated process part of
    # the candidate's orphan audit.
    if ($null -ne $ExactRootTuple -and (Test-ProcessTupleAlive $ExactRootTuple)) {
        $root = Get-ProcessCimExact -ProcessId $RootProcessId
        if ($null -ne $root -and (Test-PathEqual ([string]$root.ExecutablePath) ([string]$ExactRootTuple.executablePath))) {
            $byKey[(Get-TupleKey $ExactRootTuple)] = $ExactRootTuple
        }
    }
    return @($byKey.Values)
}

function Assert-Condition {
    param([bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
    if (-not $Condition) { throw $Message }
}

if ($AttachPid -gt 0) {
    $attached = Get-ProcessCimExact -ProcessId $AttachPid
    if ($null -eq $attached) { throw "Attach PID $AttachPid does not exist." }
    Assert-Condition (Test-PathEqual ([string]$attached.ExecutablePath) $candidatePath) (
        "Attach PID $AttachPid is not the supplied candidate. Expected '$candidatePath', got '$($attached.ExecutablePath)'."
    )
    $rootTuple = ConvertTo-ProcessTuple -Process $attached -RootProcessId $AttachPid
    $appProcessId = $AttachPid
}
else {
    $rootTuple = $null
    $appProcessId = 0
}

if ($DryRun) {
    $report.status = "dry-run"
    if ($AttachPid -gt 0) {
        $report.candidate.processId = $AttachPid
        $report.candidate.creationTimeUtc = $rootTuple.creationTimeUtc
        $report.processSnapshot = @(Get-OwnedProcessTuples -RootProcessId $AttachPid)
    }
    Write-RegressionReport
    Write-Host "Dry run complete. No app launch, input, resize, close, installation, or process termination occurred."
    Write-Host "Report: $OutputPath"
    return
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace CovenNativeRegression {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
  public delegate bool EnumWindowProc(IntPtr hWnd, IntPtr lParam);
  public static class Win32 {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowProc cb, IntPtr data);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc cb, IntPtr data);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GhostWindowFromHungWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr HungWindowFromGhostWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder value, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder value, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out UIntPtr result);
  }
}
'@

$WM_CLOSE = 0x0010
$SW_RESTORE = 9
$MOUSE_LEFTDOWN = 0x0002
$MOUSE_LEFTUP = 0x0004
$KEYUP = 0x0002
$VK_CONTROL = 0x11
$VK_MENU = 0x12
$VK_ESCAPE = 0x1B
$VK_K = 0x4B
$VK_OEM_COMMA = 0xBC
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_ASYNCWINDOWPOS = 0x4000

# Win32 geometry is DPI-virtualized for powershell.exe by default. Opt this
# thread into per-monitor-v2 before reading HWND rectangles or sending cursor
# coordinates, then map CSS pixels through main-WRY/innerWidth ratios below.
$previousDpiContext = [CovenNativeRegression.Win32]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
Assert-Condition ($previousDpiContext -ne [IntPtr]::Zero) "Could not enable per-monitor-v2 DPI awareness for native regression input."
$report.isolation.dpiAwareness = "per-monitor-v2"

function Get-WindowRectRecord {
    param([Parameter(Mandatory = $true)][IntPtr]$Handle)
    $rect = New-Object CovenNativeRegression.RECT
    if (-not [CovenNativeRegression.Win32]::GetWindowRect($Handle, [ref]$rect)) { throw "GetWindowRect failed for HWND $Handle." }
    return [pscustomobject]@{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
}

function Get-ClientScreenRectRecord {
    param([Parameter(Mandatory = $true)][IntPtr]$Handle)
    $rect = New-Object CovenNativeRegression.RECT
    $origin = New-Object CovenNativeRegression.POINT
    if (-not [CovenNativeRegression.Win32]::GetClientRect($Handle, [ref]$rect)) { throw "GetClientRect failed for HWND $Handle." }
    if (-not [CovenNativeRegression.Win32]::ClientToScreen($Handle, [ref]$origin)) { throw "ClientToScreen failed for HWND $Handle." }
    return [pscustomobject]@{ left = $origin.X; top = $origin.Y; right = $origin.X + $rect.Right; bottom = $origin.Y + $rect.Bottom; width = $rect.Right; height = $rect.Bottom }
}

function Get-WindowClassName {
    param([Parameter(Mandatory = $true)][IntPtr]$Handle)
    $class = [Text.StringBuilder]::new(256)
    [void][CovenNativeRegression.Win32]::GetClassName($Handle, $class, $class.Capacity)
    return $class.ToString()
}

function Get-WindowTitle {
    param([Parameter(Mandatory = $true)][IntPtr]$Handle)
    $title = [Text.StringBuilder]::new(512)
    [void][CovenNativeRegression.Win32]::GetWindowText($Handle, $title, $title.Capacity)
    return $title.ToString()
}

function Get-MainWindowHandle {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    $candidates = New-Object System.Collections.ArrayList
    $callback = [CovenNativeRegression.EnumWindowProc]{
        param([IntPtr]$handle, [IntPtr]$unused)
        $owner = [uint32]0
        [void][CovenNativeRegression.Win32]::GetWindowThreadProcessId($handle, [ref]$owner)
        $className = Get-WindowClassName $handle
        # Windows creates a DWM-owned Ghost window for a hung top-level HWND.
        # It must never be selected as the authoritative candidate, even if a
        # future Windows version attributes it differently.
        if ($owner -eq $ProcessId -and $className -ne "Ghost" -and [CovenNativeRegression.Win32]::IsWindowVisible($handle)) {
            $rect = New-Object CovenNativeRegression.RECT
            if ([CovenNativeRegression.Win32]::GetWindowRect($handle, [ref]$rect)) {
                [void]$candidates.Add([pscustomobject]@{
                    handle = $handle
                    area = [long]([Math]::Max(0, $rect.Right - $rect.Left)) * [long]([Math]::Max(0, $rect.Bottom - $rect.Top))
                    title = Get-WindowTitle $handle
                    className = $className
                })
            }
        }
        return $true
    }
    [void][CovenNativeRegression.Win32]::EnumWindows($callback, [IntPtr]::Zero)
    $winner = @($candidates | Sort-Object area -Descending | Select-Object -First 1)
    if ($winner.Count -eq 0 -or $winner[0].area -le 0) { return [IntPtr]::Zero }
    return [IntPtr]$winner[0].handle
}

function Test-NativeMessagePumpResponsive {
    param([IntPtr]$MainWindow, [int]$TimeoutMs = 250)
    $messageResult = [UIntPtr]::Zero
    $sent = [CovenNativeRegression.Win32]::SendMessageTimeout(
        $MainWindow, 0, [IntPtr]::Zero, [IntPtr]::Zero,
        0x0002, [uint32]$TimeoutMs, [ref]$messageResult # WM_NULL, SMTO_ABORTIFHUNG
    )
    return $sent -ne [IntPtr]::Zero
}

function Wait-MainWindowHandle {
    param([int]$ProcessId, [int]$TimeoutMs = 30000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $handle = Get-MainWindowHandle -ProcessId $ProcessId
        if ($handle -ne [IntPtr]::Zero) { return $handle }
        Start-Sleep -Milliseconds 100
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "Candidate PID $ProcessId did not expose a visible top-level window within ${TimeoutMs}ms."
}

function Wait-NativeMessagePump {
    param([IntPtr]$MainWindow, [int]$TimeoutMs = 15000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $stableSamples = 0
    do {
        if ((Test-NativeMessagePumpResponsive $MainWindow) -and -not [CovenNativeRegression.Win32]::IsHungAppWindow($MainWindow)) {
            $stableSamples += 1
            if ($stableSamples -ge 5) { return }
        }
        else { $stableSamples = 0 }
        Start-Sleep -Milliseconds 100
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "The exact candidate native message pump did not remain responsive for five consecutive probes within ${TimeoutMs}ms."
}

function Get-DirectWryWebViews {
    param([Parameter(Mandatory = $true)][IntPtr]$MainWindow)
    $result = New-Object System.Collections.ArrayList
    $callback = [CovenNativeRegression.EnumWindowProc]{
        param([IntPtr]$handle, [IntPtr]$unused)
        if ([CovenNativeRegression.Win32]::GetParent($handle) -ne $MainWindow) { return $true }
        $class = [Text.StringBuilder]::new(256)
        [void][CovenNativeRegression.Win32]::GetClassName($handle, $class, $class.Capacity)
        if ($class.ToString() -eq "WRY_WEBVIEW") {
            $rect = Get-WindowRectRecord -Handle $handle
            [void]$result.Add([pscustomobject]@{
                handle = $handle
                visible = [CovenNativeRegression.Win32]::IsWindowVisible($handle)
                left = $rect.left; top = $rect.top; right = $rect.right; bottom = $rect.bottom
                width = $rect.width; height = $rect.height; area = [long]$rect.width * [long]$rect.height
            })
        }
        return $true
    }
    [void][CovenNativeRegression.Win32]::EnumChildWindows($MainWindow, $callback, [IntPtr]::Zero)
    return @($result)
}

function Get-MainWryWebView {
    param([object[]]$WebViews)
    $main = @($WebViews | Where-Object visible | Sort-Object area -Descending | Select-Object -First 1)
    if ($main.Count -eq 0) { throw "No visible direct WRY_WEBVIEW exists for the main renderer." }
    return $main[0]
}

function Get-NativeBrowserWebViews {
    param([object[]]$WebViews, $MainWebView)
    return @($WebViews | Where-Object { $_.handle -ne $MainWebView.handle })
}

function Get-CorrelatedGhostWindows {
    param([Parameter(Mandatory = $true)][IntPtr]$MainWindow)
    # These user32 mappings correlate the OS-created Ghost to its exact hung
    # HWND. Title/rectangle heuristics can confuse two CovenCave instances and
    # are deliberately not used as process authority.
    $ghost = [CovenNativeRegression.Win32]::GhostWindowFromHungWindow($MainWindow)
    if ($ghost -eq [IntPtr]::Zero) { return @() }
    $hung = [CovenNativeRegression.Win32]::HungWindowFromGhostWindow($ghost)
    if ($hung -ne $MainWindow -or (Get-WindowClassName $ghost) -ne "Ghost") { return @() }
    $owner = [uint32]0
    [void][CovenNativeRegression.Win32]::GetWindowThreadProcessId($ghost, [ref]$owner)
    return @([pscustomobject][ordered]@{
        hwnd = $ghost.ToInt64()
        hungHwnd = $hung.ToInt64()
        processId = [int]$owner
        className = "Ghost"
        title = Get-WindowTitle $ghost
        rect = Get-WindowRectRecord $ghost
    })
}

function Add-PhaseEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [IntPtr]$MainWindow = [IntPtr]::Zero,
        $MainTarget = $null
    )
    $phase = [ordered]@{
        name = $Name
        timestampUtc = [DateTime]::UtcNow.ToString("o")
        elapsedMilliseconds = $reportWatch.ElapsedMilliseconds
        mainWindow = $null
        directWryWebViews = @()
        dom = $null
    }
    if ($MainWindow -ne [IntPtr]::Zero) {
        $main = [ordered]@{
            hwnd = $MainWindow.ToInt64()
            className = $null
            title = $null
            visible = $null
            hung = $null
            messagePumpResponsive = $null
            exactForeground = $null
            rect = $null
            clientRect = $null
            correlatedGhostWindows = @()
        }
        try { $main.className = Get-WindowClassName $MainWindow } catch { }
        try { $main.title = Get-WindowTitle $MainWindow } catch { }
        try { $main.visible = [CovenNativeRegression.Win32]::IsWindowVisible($MainWindow) } catch { }
        try { $main.hung = [CovenNativeRegression.Win32]::IsHungAppWindow($MainWindow) } catch { }
        try { $main.messagePumpResponsive = Test-NativeMessagePumpResponsive $MainWindow 100 } catch { }
        try { $main.exactForeground = [CovenNativeRegression.Win32]::GetForegroundWindow() -eq $MainWindow } catch { }
        try { $main.rect = Get-WindowRectRecord $MainWindow } catch { }
        try { $main.clientRect = Get-ClientScreenRectRecord $MainWindow } catch { }
        try { $main.correlatedGhostWindows = @(Get-CorrelatedGhostWindows $MainWindow) } catch { }
        $phase.mainWindow = $main
        try {
            $phase.directWryWebViews = @(Get-DirectWryWebViews $MainWindow | ForEach-Object {
                [ordered]@{
                    hwnd = $_.handle.ToInt64()
                    visible = [bool]$_.visible
                    left = $_.left; top = $_.top; right = $_.right; bottom = $_.bottom
                    width = $_.width; height = $_.height
                }
            })
        }
        catch { }
    }
    if ($null -ne $MainTarget) {
        try { $phase.dom = Get-MainDomState $MainTarget } catch { }
    }
    $report.phases += [pscustomobject]$phase
}

function Assert-MainWindowNotGhosted {
    param([Parameter(Mandatory = $true)][IntPtr]$MainWindow)
    Assert-Condition ((Get-WindowClassName $MainWindow) -ne "Ghost") "The authoritative candidate HWND is a Windows Ghost window."
    Assert-Condition (-not [CovenNativeRegression.Win32]::IsHungAppWindow($MainWindow)) "Windows reports the authoritative candidate HWND as hung before native input."
    Assert-Condition ((Test-NativeMessagePumpResponsive $MainWindow) -eq $true) "The authoritative candidate HWND did not answer WM_NULL before native input."
    $ghosts = @(Get-CorrelatedGhostWindows $MainWindow)
    Assert-Condition ($ghosts.Count -eq 0) "Windows created a matching Ghost window before native input; no mouse or keyboard event was sent."
}

function Assert-ExactMainForeground {
    param([Parameter(Mandatory = $true)][IntPtr]$MainWindow)
    $foreground = [CovenNativeRegression.Win32]::GetForegroundWindow()
    Assert-Condition ($foreground -eq $MainWindow) (
        "The exact main HWND is not foreground (expected $($MainWindow.ToInt64()), actual $($foreground.ToInt64()))."
    )
}

function Focus-MainWindow {
    param([IntPtr]$MainWindow)
    Assert-MainWindowNotGhosted $MainWindow
    if ([CovenNativeRegression.Win32]::GetForegroundWindow() -eq $MainWindow) { return }
    # Windows foreground-lock rules can reject a bare SetForegroundWindow.
    # A harmless ALT tap makes this process eligible; verify focus before any
    # coordinates are measured or input is sent, retrying for a bounded period.
    foreach ($attempt in 1..4) {
        [CovenNativeRegression.Win32]::keybd_event([byte]$VK_MENU, 0, 0, [UIntPtr]::Zero)
        [CovenNativeRegression.Win32]::keybd_event([byte]$VK_MENU, 0, $KEYUP, [UIntPtr]::Zero)
        [void][CovenNativeRegression.Win32]::SetForegroundWindow($MainWindow)
        Start-Sleep -Milliseconds 250
        if ([CovenNativeRegression.Win32]::GetForegroundWindow() -eq $MainWindow) { return }
        # Foreground lock can still reject background automation. A real click
        # in the native title-bar band is the bounded, user-equivalent fallback.
        Assert-MainWindowNotGhosted $MainWindow
        $window = Get-WindowRectRecord $MainWindow
        [void][CovenNativeRegression.Win32]::SetCursorPos([int](($window.left + $window.right) / 2), $window.top + 10)
        $titlePoint = New-Object CovenNativeRegression.POINT
        [void][CovenNativeRegression.Win32]::GetCursorPos([ref]$titlePoint)
        $titleHit = [CovenNativeRegression.Win32]::WindowFromPoint($titlePoint)
        Assert-Condition ((Get-WindowClassName $titleHit) -ne "Ghost") "Windows placed a Ghost window over the title bar before the focus click."
        [CovenNativeRegression.Win32]::mouse_event($MOUSE_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        [CovenNativeRegression.Win32]::mouse_event($MOUSE_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 250
        if ([CovenNativeRegression.Win32]::GetForegroundWindow() -eq $MainWindow) { return }
    }
    throw "The exact candidate main HWND did not become foreground within the bounded retries."
}

function Get-MainWindowWorkAreaPlacement {
    param([IntPtr]$MainWindow, [switch]$UseWorkArea)
    $window = Get-WindowRectRecord $MainWindow
    $monitor = [CovenNativeRegression.Win32]::MonitorFromWindow($MainWindow, 2) # MONITOR_DEFAULTTONEAREST
    Assert-Condition ($monitor -ne [IntPtr]::Zero) "MonitorFromWindow failed for the exact candidate."
    $info = New-Object CovenNativeRegression.MONITORINFO
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][CovenNativeRegression.MONITORINFO])
    Assert-Condition ([CovenNativeRegression.Win32]::GetMonitorInfo($monitor, [ref]$info)) "GetMonitorInfo failed for the candidate monitor."
    $margin = if ($UseWorkArea) { 72 } else { 24 }
    $workWidth = $info.rcWork.Right - $info.rcWork.Left
    $workHeight = $info.rcWork.Bottom - $info.rcWork.Top
    $width = if ($UseWorkArea) { $workWidth - 2 * $margin } else { [Math]::Min($window.width, $workWidth - 2 * $margin) }
    $height = if ($UseWorkArea) { $workHeight - 2 * $margin } else { [Math]::Min($window.height, $workHeight - 2 * $margin) }
    $left = [Math]::Max($info.rcWork.Left + $margin, [Math]::Min($window.left, $info.rcWork.Right - $margin - $width))
    $top = [Math]::Max($info.rcWork.Top + $margin, [Math]::Min($window.top, $info.rcWork.Bottom - $margin - $height))
    return [pscustomobject]@{ left = [int]$left; top = [int]$top; width = [int]$width; height = [int]$height }
}

function Wait-MainWindowPlacement {
    param([IntPtr]$MainWindow, $Expected, [switch]$PositionOnly, [switch]$SizeOnly, [int]$TimeoutMs = 3000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $actual = Get-WindowRectRecord $MainWindow
        $positionMatches = $SizeOnly -or (
            [Math]::Abs($actual.left - $Expected.left) -le 2 -and
            [Math]::Abs($actual.top - $Expected.top) -le 2
        )
        $sizeMatches = $PositionOnly -or (
            [Math]::Abs($actual.width - $Expected.width) -le 2 -and
            [Math]::Abs($actual.height - $Expected.height) -le 2
        )
        if ($positionMatches -and $sizeMatches) { return }
        Start-Sleep -Milliseconds 40
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "The asynchronous candidate window placement did not settle within ${TimeoutMs}ms."
}

function Set-MainWindowPlacementAsync {
    param([IntPtr]$MainWindow, [switch]$UseWorkArea, $MainTarget = $null)
    $window = Get-WindowRectRecord $MainWindow
    $target = Get-MainWindowWorkAreaPlacement $MainWindow -UseWorkArea:$UseWorkArea
    # Keep move and resize as distinct async message-queue operations. This
    # mode never activates the window and never blocks this harness on the UI
    # thread inside a synchronous SetWindowPos call.
    if ($target.left -ne $window.left -or $target.top -ne $window.top) {
        $moveFlags = $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_ASYNCWINDOWPOS
        Assert-Condition ([CovenNativeRegression.Win32]::SetWindowPos(
            $MainWindow, [IntPtr]::Zero, $target.left, $target.top, 0, 0, $moveFlags
        )) "Asynchronous SetWindowPos could not move the exact candidate into its monitor work area."
        Wait-MainWindowPlacement $MainWindow $target -PositionOnly
        Add-PhaseEvidence -Name "async-window-move-complete" -MainWindow $MainWindow -MainTarget $MainTarget
    }
    $window = Get-WindowRectRecord $MainWindow
    if ($target.width -ne $window.width -or $target.height -ne $window.height) {
        $resizeFlags = $SWP_NOMOVE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_ASYNCWINDOWPOS
        Assert-Condition ([CovenNativeRegression.Win32]::SetWindowPos(
            $MainWindow, [IntPtr]::Zero, 0, 0, $target.width, $target.height, $resizeFlags
        )) "Asynchronous SetWindowPos could not resize the exact candidate inside its monitor work area."
        Wait-MainWindowPlacement $MainWindow $target -SizeOnly
        Add-PhaseEvidence -Name "async-window-resize-complete" -MainWindow $MainWindow -MainTarget $MainTarget
    }
}

function Ensure-MainWindowWithinWorkArea {
    param([IntPtr]$MainWindow, [switch]$UseWorkArea)
    $window = Get-WindowRectRecord $MainWindow
    $target = Get-MainWindowWorkAreaPlacement $MainWindow -UseWorkArea:$UseWorkArea
    $left = $target.left; $top = $target.top; $width = $target.width; $height = $target.height
    if ($left -ne $window.left -or $top -ne $window.top -or $width -ne $window.width -or $height -ne $window.height) {
        # This synchronous placement is intentionally isolated behind
        # -PreparationMode LegacyFullPrep for reproducing the historical harness.
        Assert-Condition ([CovenNativeRegression.Win32]::SetWindowPos($MainWindow, [IntPtr]::Zero, $left, $top, $width, $height, 0x0014)) "SetWindowPos could not contain the candidate inside its monitor work area."
        Start-Sleep -Milliseconds 250
    }
}

function Invoke-PhysicalScreenClick {
    param([IntPtr]$MainWindow, [int]$X, [int]$Y)
    Add-PhaseEvidence -Name "before-physical-click" -MainWindow $MainWindow
    Assert-MainWindowNotGhosted $MainWindow
    Focus-MainWindow $MainWindow
    Assert-ExactMainForeground $MainWindow
    Assert-Condition ([CovenNativeRegression.Win32]::SetCursorPos($X, $Y)) "SetCursorPos failed for ($X,$Y)."
    Start-Sleep -Milliseconds 25
    $point = New-Object CovenNativeRegression.POINT
    [void][CovenNativeRegression.Win32]::GetCursorPos([ref]$point)
    $hitWindow = [CovenNativeRegression.Win32]::WindowFromPoint($point)
    $hitProcessId = [uint32]0
    [void][CovenNativeRegression.Win32]::GetWindowThreadProcessId($hitWindow, [ref]$hitProcessId)
    $hitClass = [Text.StringBuilder]::new(256)
    [void][CovenNativeRegression.Win32]::GetClassName($hitWindow, $hitClass, $hitClass.Capacity)
    $report.lastPhysicalInput.cursor = [ordered]@{ x = $point.X; y = $point.Y }
    $report.lastPhysicalInput.hitHwnd = $hitWindow.ToInt64()
    $report.lastPhysicalInput.hitClass = $hitClass.ToString()
    $report.lastPhysicalInput.hitProcessId = [int]$hitProcessId
    $report.lastPhysicalInput.mainWindowHung = [CovenNativeRegression.Win32]::IsHungAppWindow($MainWindow)
    $report.lastPhysicalInput.foregroundHwnd = [CovenNativeRegression.Win32]::GetForegroundWindow().ToInt64()
    Assert-Condition ([Math]::Abs($point.X - $X) -le 1 -and [Math]::Abs($point.Y - $Y) -le 1) "Windows clamped the requested physical click outside the monitor work area."
    Assert-MainWindowNotGhosted $MainWindow
    Assert-ExactMainForeground $MainWindow
    Assert-Condition ($hitClass.ToString() -ne "Ghost") "Windows ghosted the exact candidate native window; OS mouse input is being intercepted before the main WebView."
    [CovenNativeRegression.Win32]::mouse_event($MOUSE_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 25
    [CovenNativeRegression.Win32]::mouse_event($MOUSE_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-KeyChord {
    param([IntPtr]$MainWindow, [byte]$Key, [switch]$Control)
    Add-PhaseEvidence -Name "before-key-input" -MainWindow $MainWindow
    Assert-MainWindowNotGhosted $MainWindow
    Focus-MainWindow $MainWindow
    Assert-ExactMainForeground $MainWindow
    Assert-MainWindowNotGhosted $MainWindow
    if ($Control) { [CovenNativeRegression.Win32]::keybd_event([byte]$VK_CONTROL, 0, 0, [UIntPtr]::Zero) }
    [CovenNativeRegression.Win32]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
    [CovenNativeRegression.Win32]::keybd_event($Key, 0, $KEYUP, [UIntPtr]::Zero)
    if ($Control) { [CovenNativeRegression.Win32]::keybd_event([byte]$VK_CONTROL, 0, $KEYUP, [UIntPtr]::Zero) }
}

function Invoke-PhysicalWindowResize {
    param([IntPtr]$MainWindow, [int]$Delta)
    Assert-MainWindowNotGhosted $MainWindow
    Set-MainWindowPlacementAsync $MainWindow
    Focus-MainWindow $MainWindow
    Assert-ExactMainForeground $MainWindow
    $before = Get-WindowRectRecord $MainWindow
    $startX = $before.right - 2
    $startY = $before.bottom - 2
    [void][CovenNativeRegression.Win32]::SetCursorPos($startX, $startY)
    Start-Sleep -Milliseconds 40
    $resizePoint = New-Object CovenNativeRegression.POINT
    [void][CovenNativeRegression.Win32]::GetCursorPos([ref]$resizePoint)
    $resizeHit = [CovenNativeRegression.Win32]::WindowFromPoint($resizePoint)
    Assert-MainWindowNotGhosted $MainWindow
    Assert-ExactMainForeground $MainWindow
    Assert-Condition ((Get-WindowClassName $resizeHit) -ne "Ghost") "Windows placed a Ghost window over the native resize edge."
    $mouseDown = $false
    try {
        [CovenNativeRegression.Win32]::mouse_event($MOUSE_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        $mouseDown = $true
        foreach ($step in 1..4) {
            [void][CovenNativeRegression.Win32]::SetCursorPos($startX + [int]($Delta * $step / 4), $startY + [int]($Delta * $step / 4))
            Start-Sleep -Milliseconds 35
        }
    }
    finally {
        if ($mouseDown) {
            [CovenNativeRegression.Win32]::mouse_event($MOUSE_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        }
    }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $after = Get-WindowRectRecord $MainWindow
        if ([Math]::Abs($after.width - $before.width) -ge 2 -or [Math]::Abs($after.height - $before.height) -ge 2) {
            Set-MainWindowPlacementAsync $MainWindow
            return
        }
        Start-Sleep -Milliseconds 50
    } while ($watch.ElapsedMilliseconds -lt 2000)
    throw "Physical native-window edge drag did not resize the candidate window."
}

function Get-CdpTargets {
    param([int]$Port)
    # Windows PowerShell 5 treats Invoke-RestMethod's top-level JSON array as
    # one pipeline object. Emit each target explicitly or callers see one
    # object whose id/WebSocket properties are themselves arrays.
    $raw = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 -ErrorAction Stop
    foreach ($target in $raw) { Write-Output $target }
}

function Test-AllowedChildUrl {
    param($Link, [string]$ActualUrl)
    if (-not $ActualUrl) { return $false }
    try { $uri = [Uri]$ActualUrl } catch { return $false }
    if ($uri.Scheme -ne "https") { return $false }
    $rules = @($childUrlRules[[string]$Link.label])
    foreach ($rule in $rules) {
        if (-not $uri.Host.Equals([string]$rule.host, [StringComparison]::OrdinalIgnoreCase)) { continue }
        if (-not $uri.AbsolutePath.StartsWith([string]$rule.pathPrefix, [StringComparison]::Ordinal)) { continue }
        if ($rule.queryContains -and $uri.Query.IndexOf([string]$rule.queryContains, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
        return $true
    }
    return $false
}

function Wait-ActiveChildUrl {
    param([int]$Port, $MainTarget, $Link, [int]$TimeoutMs = 10000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $lastUrls = @()
    do {
        try {
            $children = @(Get-CdpTargets $Port | Where-Object {
                $_.type -eq "page" -and $_.id -ne $MainTarget.id -and $_.webSocketDebuggerUrl
            })
            $lastUrls = @($children | ForEach-Object { [string]$_.url })
            $allowedVisible = @()
            foreach ($child in @($children | Where-Object { Test-AllowedChildUrl $Link ([string]$_.url) })) {
                try {
                    $runtime = Invoke-CdpExpression $child "({ href: location.href, visibilityState: document.visibilityState })" 750
                    if ($runtime.visibilityState -eq "visible" -and (Test-AllowedChildUrl $Link ([string]$runtime.href))) {
                        $allowedVisible += [pscustomobject]@{ target = $child; actualUrl = [string]$runtime.href; visibilityState = [string]$runtime.visibilityState }
                    }
                }
                catch { }
            }
            if ($allowedVisible.Count -eq 1) {
                return $allowedVisible[0]
            }
        }
        catch { }
        Start-Sleep -Milliseconds 75
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "No native child CDP target reached an allowed URL for $($Link.label). Actual child URLs: $($lastUrls -join ', ')"
}

function Wait-CdpTargets {
    param([int]$Port, [int]$TimeoutMs = 30000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        try {
            $targets = @(Get-CdpTargets $Port)
            if ($targets.Count -gt 0) {
                foreach ($target in $targets) { Write-Output $target }
                return
            }
        }
        catch { }
        Start-Sleep -Milliseconds 100
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "CDP port $Port did not expose targets within ${TimeoutMs}ms."
}

$script:cdpId = 0
function Open-CdpSocket {
    param([string]$WebSocketUrl, [int]$TimeoutMs = 3000)
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $tokenSource = [Threading.CancellationTokenSource]::new($TimeoutMs)
    try {
        [void]$socket.ConnectAsync([Uri]$WebSocketUrl, $tokenSource.Token).GetAwaiter().GetResult()
        return $socket
    }
    catch { $socket.Dispose(); throw }
    finally { $tokenSource.Dispose() }
}

function Send-CdpPayload {
    param($Socket, $Payload)
    $json = $Payload | ConvertTo-Json -Compress -Depth 12
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    [void]$Socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

function Receive-CdpResponse {
    param($Socket, [int]$Id, [int]$TimeoutMs = 3000)
    $tokenSource = [Threading.CancellationTokenSource]::new($TimeoutMs)
    try {
        while ($true) {
            $stream = [IO.MemoryStream]::new()
            try {
                do {
                    $buffer = New-Object byte[] 65536
                    $segment = [ArraySegment[byte]]::new($buffer)
                    $received = $Socket.ReceiveAsync($segment, $tokenSource.Token).GetAwaiter().GetResult()
                    if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw "CDP socket closed before response $Id." }
                    $stream.Write($buffer, 0, $received.Count)
                } while (-not $received.EndOfMessage)
                $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
                if ($message.PSObject.Properties.Name -contains "id" -and [int]$message.id -eq $Id) {
                    if ($message.PSObject.Properties.Name -contains "error") { throw "CDP error: $($message.error | ConvertTo-Json -Compress)" }
                    return $message.result
                }
            }
            finally { $stream.Dispose() }
        }
    }
    finally { $tokenSource.Dispose() }
}

function Invoke-CdpCommand {
    param([string]$WebSocketUrl, [string]$Method, $Params = @{}, [int]$TimeoutMs = 3000)
    $socket = Open-CdpSocket $WebSocketUrl $TimeoutMs
    try {
        $script:cdpId += 1
        $id = $script:cdpId
        Send-CdpPayload $socket ([ordered]@{ id = $id; method = $Method; params = $Params })
        return Receive-CdpResponse $socket $id $TimeoutMs
    }
    finally { $socket.Dispose() }
}

function Invoke-CdpExpression {
    param($Target, [string]$Expression, [int]$TimeoutMs = 3000)
    $result = Invoke-CdpCommand -WebSocketUrl ([string]$Target.webSocketDebuggerUrl) -Method "Runtime.evaluate" -TimeoutMs $TimeoutMs -Params ([ordered]@{
        expression = $Expression
        returnByValue = $true
        awaitPromise = $true
    })
    if ($result.PSObject.Properties.Name -contains "exceptionDetails") {
        throw "CDP expression failed: $($result.exceptionDetails.text)"
    }
    return $result.result.value
}

function Find-MainCdpTarget {
    param([int]$Port, [int]$TimeoutMs = 30000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $probeErrors = New-Object System.Collections.ArrayList
    # The manifest link is emitted by RootLayout on every Cave route, including
    # /settings where workspace navigation controls are intentionally absent.
    # DOM fallbacks also cover an early render before Next inserts metadata.
    $probeExpression = 'Boolean(document.querySelector(''link[rel="manifest"][href="/manifest.webmanifest"], [aria-label="Settings"], [aria-label="Account / settings"], [data-native-browser-viewport], [id^="settings-"]''))'
    do {
        foreach ($target in @(Wait-CdpTargets $Port ([Math]::Min(2000, $TimeoutMs)))) {
            if (-not $target.webSocketDebuggerUrl -or $target.type -ne "page") { continue }
            try {
                $isMain = Invoke-CdpExpression -Target $target -Expression $probeExpression -TimeoutMs 1500
                if ($isMain) { return $target }
            }
            catch {
                if ($probeErrors.Count -lt 8) {
                    [void]$probeErrors.Add("$($target.id): $($_.Exception.Message)")
                }
            }
        }
        Start-Sleep -Milliseconds 100
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    $detail = if ($probeErrors.Count -gt 0) { " Probe errors: " + ($probeErrors -join " | ") } else { "" }
    throw "No CDP target on port $Port matched CovenCave's main renderer.$detail"
}

function Wait-MainRendererReady {
    param($MainTarget, [int]$TimeoutMs = 15000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        try {
            $ready = Invoke-CdpExpression $MainTarget "document.readyState === 'complete' && Boolean(document.body)" 1500
            if ($ready) { return }
        }
        catch { }
        Start-Sleep -Milliseconds 100
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "The exact candidate main renderer did not reach DOM readiness within ${TimeoutMs}ms."
}

function Get-MainDomState {
    param($MainTarget)
    return Invoke-CdpExpression $MainTarget @'
(() => {
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 1 && rect.height > 1;
  };
  const activeTab = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find(visible);
  const inactiveTabs = [...document.querySelectorAll('[role="tab"][aria-selected="false"]')].filter(visible);
  const stop = [...document.querySelectorAll('[aria-label="Stop"]')].find(visible);
  const reload = [...document.querySelectorAll('[aria-label="Reload"]')].find(visible);
  return {
    path: location.pathname,
    hash: location.hash,
    address: document.querySelector('[aria-label="Address bar"]')?.value ?? null,
    hasViewport: Boolean(document.querySelector('[data-native-browser-viewport]')),
    activeTabLabel: activeTab?.getAttribute('aria-label') ?? null,
    inactiveTabCount: inactiveTabs.length,
    quickOpenVisible: [...document.querySelectorAll('[role="dialog"], [role="listbox"]')].some(visible),
    addressOverlayVisible: visible(document.querySelector('[aria-label="Close address bar"]')),
    reloadControl: stop ? 'Stop' : (reload ? 'Reload' : null),
    loading: Boolean(stop),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight
  };
})()
'@
}

function Wait-StableMainGeometry {
    param(
        [IntPtr]$MainWindow,
        $MainTarget,
        [int]$StableForMs = 1000,
        [int]$TimeoutMs = 20000
    )
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $stableSinceMs = $null
    $lastSignature = $null
    $lastEvidence = $null
    do {
        # A Ghost is a terminal startup finding, not a transient geometry miss.
        Assert-MainWindowNotGhosted $MainWindow
        try {
            $dom = Get-MainDomState $MainTarget
            $wrys = @(Get-DirectWryWebViews $MainWindow)
            $mainWry = Get-MainWryWebView $wrys
            $windowRect = Get-WindowRectRecord $MainWindow
            $signature = "{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}|{9}" -f (
                [int]$dom.innerWidth, [int]$dom.innerHeight,
                [int]$mainWry.left, [int]$mainWry.top, [int]$mainWry.right, [int]$mainWry.bottom,
                [int]$windowRect.left, [int]$windowRect.top, [int]$windowRect.right, [int]$windowRect.bottom
            )
            $lastEvidence = [pscustomobject][ordered]@{
                stableForMilliseconds = 0
                dom = [ordered]@{ innerWidth = [int]$dom.innerWidth; innerHeight = [int]$dom.innerHeight }
                mainWry = [ordered]@{
                    hwnd = $mainWry.handle.ToInt64()
                    left = $mainWry.left; top = $mainWry.top; right = $mainWry.right; bottom = $mainWry.bottom
                    width = $mainWry.width; height = $mainWry.height
                }
                windowRect = $windowRect
            }
            if ($signature -eq $lastSignature) {
                $stableDuration = $watch.ElapsedMilliseconds - [long]$stableSinceMs
                $lastEvidence.stableForMilliseconds = $stableDuration
                if ($stableDuration -ge $StableForMs) { return $lastEvidence }
            }
            else {
                $lastSignature = $signature
                $stableSinceMs = $watch.ElapsedMilliseconds
            }
        }
        catch {
            $lastSignature = $null
            $stableSinceMs = $null
        }
        Start-Sleep -Milliseconds 100
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    $detail = if ($null -ne $lastEvidence) { " Last evidence: $($lastEvidence | ConvertTo-Json -Compress -Depth 6)" } else { "" }
    throw "DOM and main WRY_WEBVIEW geometry did not remain stable for ${StableForMs}ms within ${TimeoutMs}ms.$detail"
}

function Start-TrustedPtyForRegression {
    param($MainTarget, [int]$RootProcessId, $ExactRootTuple, [string]$UniqueWebViewProfile)
    $before = @{}
    foreach ($tuple in @(Get-AttributedProcessTuples $RootProcessId $ExactRootTuple $UniqueWebViewProfile)) {
        $before[(Get-TupleKey $tuple)] = $true
    }
    $threadId = "native-regression-$([Guid]::NewGuid().ToString('N'))"
    $projectRoot = if ($PtyProjectRoot) { Get-FullPath $PtyProjectRoot } else { Split-Path -Parent $candidatePath }
    Assert-Condition (Test-Path -LiteralPath $projectRoot -PathType Container) "Trusted PTY project root does not exist: $projectRoot"
    $threadJson = $threadId | ConvertTo-Json -Compress
    $rootJson = $projectRoot | ConvertTo-Json -Compress
    $result = Invoke-CdpExpression $MainTarget @"
(async () => {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') return { started: false, error: 'trusted Tauri invoke unavailable' };
  await invoke('pty_start', { options: {
    thread_id: $threadJson,
    project_root: $rootJson,
    cols: 80,
    rows: 24
  }});
  return { started: true };
})()
"@ 10000
    $ptyError = if ($result.PSObject.Properties.Name -contains "error") { [string]$result.error } else { "unknown error" }
    Assert-Condition ([bool]$result.started) "Trusted main renderer could not invoke pty_start: $ptyError"

    $report.ptySetup.threadId = $threadId
    $report.ptySetup.projectRoot = $projectRoot
    $report.ptySetup.started = $true
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $current = @(Get-AttributedProcessTuples $RootProcessId $ExactRootTuple $UniqueWebViewProfile)
        $newPty = @($current | Where-Object {
            $_.kind -eq "pty" -and -not $before.ContainsKey((Get-TupleKey $_))
        } | Sort-Object creationTimeUtcTicks | Select-Object -First 1)
        if ($newPty.Count -eq 1) {
            $report.ptySetup.newExactTuple = $newPty[0]
            return $newPty[0]
        }
        Start-Sleep -Milliseconds 50
    } while ($watch.ElapsedMilliseconds -lt 5000)
    throw "pty_start returned successfully but no new exact PTY PID+creation tuple appeared under the candidate."
}

function Get-DomBox {
    param($MainTarget, [string]$Needle, [ValidateSet("aria", "text", "selector", "inactive-tab")][string]$Mode)
    $needleJson = $Needle | ConvertTo-Json -Compress
    $modeJson = $Mode | ConvertTo-Json -Compress
    $expression = @"
(() => {
  const needle = $needleJson;
  const mode = $modeJson;
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' &&
      rect.width > 1 && rect.height > 1 && rect.right > 0 && rect.bottom > 0 &&
      rect.left < window.innerWidth && rect.top < window.innerHeight;
  };
  let elements;
  if (mode === 'selector') elements = [...document.querySelectorAll(needle)];
  else if (mode === 'inactive-tab') elements = [...document.querySelectorAll('[role="tab"][aria-selected="false"]')];
  else elements = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
  let el = elements.find((candidate) => {
    if (!visible(candidate)) return false;
    if (mode === 'aria') return (candidate.getAttribute('aria-label') || '') === needle;
    if (mode === 'text') return (candidate.textContent || '').trim() === needle;
    return true;
  });
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    text: (el.textContent || '').trim(), aria: el.getAttribute('aria-label') };
})()
"@
    return Invoke-CdpExpression $MainTarget $expression
}

function Wait-DomBox {
    param($MainTarget, [string]$Needle, [string]$Mode, [int]$TimeoutMs = 5000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        try {
            $box = Get-DomBox $MainTarget $Needle $Mode
            if ($null -ne $box -and $box.width -gt 1 -and $box.height -gt 1) { return $box }
        }
        catch { }
        Start-Sleep -Milliseconds 60
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "DOM target '$Needle' ($Mode) was not visibly clickable within ${TimeoutMs}ms."
}

function Convert-DomBoxToScreenRect {
    param($Box, $MainWebView)
    $scaleX = $MainWebView.width / [double]$Box.innerWidth
    $scaleY = $MainWebView.height / [double]$Box.innerHeight
    return [pscustomobject]@{
        left = [int][Math]::Round($MainWebView.left + $Box.x * $scaleX)
        top = [int][Math]::Round($MainWebView.top + $Box.y * $scaleY)
        right = [int][Math]::Round($MainWebView.left + ($Box.x + $Box.width) * $scaleX)
        bottom = [int][Math]::Round($MainWebView.top + ($Box.y + $Box.height) * $scaleY)
    }
}

function Invoke-PhysicalDomClick {
    param([IntPtr]$MainWindow, $MainTarget, [string]$Needle, [string]$Mode, [int]$TimeoutMs = 5000)
    # CDP is read-only here. Acquire the current DOM and native geometry without
    # scrolling or focusing, then make the Ghost/foreground checks immediately
    # before the real user32 input is emitted.
    Assert-MainWindowNotGhosted $MainWindow
    $box = Wait-DomBox $MainTarget $Needle $Mode $TimeoutMs
    $wrys = @(Get-DirectWryWebViews $MainWindow)
    $mainWry = Get-MainWryWebView $wrys
    $screen = Convert-DomBoxToScreenRect $box $mainWry
    $clickX = [int](($screen.left + $screen.right) / 2)
    $clickY = [int](($screen.top + $screen.bottom) / 2)
    $report.lastPhysicalInput = [ordered]@{
        needle = $Needle; mode = $Mode
        dom = [ordered]@{ x = $box.x; y = $box.y; width = $box.width; height = $box.height; innerWidth = $box.innerWidth; innerHeight = $box.innerHeight }
        mainWry = [ordered]@{ hwnd = $mainWry.handle.ToInt64(); left = $mainWry.left; top = $mainWry.top; width = $mainWry.width; height = $mainWry.height }
        screen = [ordered]@{ x = $clickX; y = $clickY }
        cursor = $null; hitHwnd = $null; hitClass = $null; hitProcessId = $null; mainWindowHung = $null; foregroundHwnd = $null
    }
    Write-Host "[native-regression] physical click '$Needle' ($Mode) at $clickX,$clickY"
    Invoke-PhysicalScreenClick $MainWindow $clickX $clickY
    return $box
}

function Wait-DomState {
    param($MainTarget, [scriptblock]$Predicate, [string]$Description, [int]$TimeoutMs = 5000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        try {
            $state = Get-MainDomState $MainTarget
            if (& $Predicate $state) { return $state }
        }
        catch { }
        Start-Sleep -Milliseconds 60
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "Timed out waiting for $Description after ${TimeoutMs}ms."
}

function Assert-RectNear {
    param($Actual, $Expected, [int]$Tolerance, [string]$Context)
    foreach ($edge in @("left", "top", "right", "bottom")) {
        if ([Math]::Abs([int]$Actual.$edge - [int]$Expected.$edge) -gt $Tolerance) {
            throw "$Context $edge mismatch: actual=$($Actual.$edge), expected=$($Expected.$edge), tolerance=$Tolerance."
        }
    }
}

function Wait-NativeBrowserActive {
    param([IntPtr]$MainWindow, $MainTarget, [int]$TimeoutMs = 6000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $lastGeometryMismatch = $null
    do {
        $wrys = @(Get-DirectWryWebViews $MainWindow)
        if ($wrys.Count -ge 2) {
            $mainWry = Get-MainWryWebView $wrys
            $visible = @(Get-NativeBrowserWebViews $wrys $mainWry | Where-Object visible)
            if ($visible.Count -eq 1) {
                try {
                    $viewport = Wait-DomBox $MainTarget "[data-native-browser-viewport]" "selector" 1000
                    $expected = Convert-DomBoxToScreenRect $viewport $mainWry
                    $actual = $visible[0]
                    $client = Get-ClientScreenRectRecord $MainWindow
                    Assert-Condition (
                        $actual.left -ge ($client.left - $ClientContainmentTolerancePx) -and
                        $actual.top -ge ($client.top - $ClientContainmentTolerancePx) -and
                        $actual.right -le ($client.right + $ClientContainmentTolerancePx) -and
                        $actual.bottom -le ($client.bottom + $ClientContainmentTolerancePx)
                    ) "Native Browser WRY_WEBVIEW escaped the main client rectangle beyond the strict ${ClientContainmentTolerancePx}px containment limit."
                    Assert-RectNear $actual $expected $BoundsTolerancePx "Native Browser viewport"
                    return [pscustomobject]@{ webView = $actual; expected = $expected; directWryCount = $wrys.Count }
                }
                catch {
                    # Resize/reflow updates the DOM and HWND on separate queues.
                    # A mismatched first frame is not a failure; require them to
                    # converge within the bounded poll interval.
                    $lastGeometryMismatch = $_.Exception.Message
                }
            }
        }
        Start-Sleep -Milliseconds 60
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    $detail = if ($lastGeometryMismatch) { " Last geometry mismatch: $lastGeometryMismatch" } else { "" }
    throw "Expected one settled visible native Browser WRY_WEBVIEW within ${TimeoutMs}ms.$detail"
}

function Wait-NativeBrowserInactive {
    param([IntPtr]$MainWindow, [int]$TimeoutMs = 4000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $wrys = @(Get-DirectWryWebViews $MainWindow)
        if ($wrys.Count -ge 1) {
            $mainWry = Get-MainWryWebView $wrys
            $visible = @(Get-NativeBrowserWebViews $wrys $mainWry | Where-Object visible)
            if ($visible.Count -eq 0) { return }
        }
        Start-Sleep -Milliseconds 50
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    throw "A direct native Browser WRY_WEBVIEW remained visible while Browser was inactive or covered."
}

function Open-SettingsAbout {
    param([IntPtr]$MainWindow, $MainTarget)
    $state = Get-MainDomState $MainTarget
    if ($state.path -ne "/settings") {
        $settingsLabel = $null
        try { [void](Wait-DomBox $MainTarget "Settings" "aria" 750); $settingsLabel = "Settings" } catch { }
        if (-not $settingsLabel) {
            try { [void](Wait-DomBox $MainTarget "Account / settings" "aria" 750); $settingsLabel = "Account / settings" } catch { }
        }
        if (-not $settingsLabel) {
            try {
                # Collapsed desktop navigation deliberately mounts Settings at
                # 0x0. Open the real shell rail with OS input, which also moves
                # keyboard focus out of a native Browser child and into Cave.
                Invoke-PhysicalDomClick $MainWindow $MainTarget "Expand navigation" "aria" 5000
                try { [void](Wait-DomBox $MainTarget "Settings" "aria" 3000); $settingsLabel = "Settings" }
                catch { [void](Wait-DomBox $MainTarget "Account / settings" "aria" 3000); $settingsLabel = "Account / settings" }
            }
            catch { }
        }
        if ($settingsLabel) {
            Invoke-PhysicalDomClick $MainWindow $MainTarget $settingsLabel "aria" 15000
        }
        else {
            # Last fallback for shells without a navigation expander.
            Invoke-KeyChord $MainWindow ([byte]$VK_OEM_COMMA) -Control
        }
        [void](Wait-DomState $MainTarget { param($s) $s.path -eq "/settings" } "physical Settings input to change route" 10000)
    }
    Wait-NativeBrowserInactive $MainWindow
    $state = Get-MainDomState $MainTarget
    if ($state.hash -ne "#about") {
        Invoke-PhysicalDomClick $MainWindow $MainTarget "About" "text" 15000
        [void](Wait-DomState $MainTarget { param($s) $s.path -eq "/settings" -and $s.hash -eq "#about" } "the physical About click to select the Links section")
    }
    # A cold Next dev route can compile after the hash changes. Keep this wait
    # bounded but long enough that dev compilation is not mistaken for a click.
    [void](Wait-DomBox $MainTarget "GitHub" "text" 15000)
}

function Invoke-OneStressCycle {
    param([IntPtr]$MainWindow, $MainTarget, $Link, [int]$Cycle)
    Write-Host "[native-regression] cycle $Cycle/${Cycles}: $($Link.label)"
    Add-PhaseEvidence -Name "cycle-$Cycle-start" -MainWindow $MainWindow -MainTarget $MainTarget
    $coverage = $linkCoverageByLabel[[string]$Link.label]
    $coverage.attempts = [int]$coverage.attempts + 1
    $transition = [ordered]@{
        cycle = $Cycle
        link = $Link.label
        href = $Link.href
        actualChildUrl = $null
        inactiveTabChanged = $false
        quickOpenShown = $false
        quickOpenHidden = $false
        addressOverlayShown = $false
        addressOverlayHidden = $false
        reloadStarted = $false
        reloadCompleted = $false
        passed = $false
    }
    Open-SettingsAbout $MainWindow $MainTarget
    [void](Invoke-PhysicalDomClick $MainWindow $MainTarget ([string]$Link.label) "text")
    $linkState = Wait-DomState $MainTarget { param($s) $s.hasViewport -and $s.address -eq $Link.href } "exact $($Link.label) Browser navigation" 7000
    [void](Wait-NativeBrowserActive $MainWindow $MainTarget)
    $childUrl = Wait-ActiveChildUrl $CdpPort $MainTarget $Link 10000
    $transition.actualChildUrl = $childUrl.actualUrl
    $coverage.actualUrls += [string]$childUrl.actualUrl

    # Physically switch a native Browser tab, then exercise the quick-open overlay.
    # Keep a non-empty diagnostic needle; Windows PowerShell can collapse an
    # empty positional string while forwarding nested function arguments.
    Assert-Condition ([int]$linkState.inactiveTabCount -ge 1) "No inactive native Browser tab existed before the tab-switch probe."
    $activeTabBefore = [string]$linkState.activeTabLabel
    $inactiveBox = Invoke-PhysicalDomClick $MainWindow $MainTarget "any-inactive-tab" "inactive-tab"
    $switchedState = Wait-DomState $MainTarget {
        param($s) $s.activeTabLabel -and $s.activeTabLabel -ne $activeTabBefore
    } "the physical inactive-tab click to change the selected Browser tab"
    $transition.inactiveTabChanged = $true
    Start-Sleep -Milliseconds $TransitionDelayMs
    [void](Wait-NativeBrowserActive $MainWindow $MainTarget)
    Assert-Condition (-not [bool]$switchedState.quickOpenVisible) "Quick-open was unexpectedly visible before Ctrl+K."
    Invoke-KeyChord $MainWindow ([byte]$VK_K) -Control
    [void](Wait-DomState $MainTarget { param($s) $s.quickOpenVisible } "quick-open to become visible after Ctrl+K")
    $transition.quickOpenShown = $true
    Wait-NativeBrowserInactive $MainWindow
    Invoke-KeyChord $MainWindow ([byte]$VK_ESCAPE)
    [void](Wait-DomState $MainTarget { param($s) -not $s.quickOpenVisible } "quick-open to close after Escape")
    $transition.quickOpenHidden = $true
    [void](Wait-NativeBrowserActive $MainWindow $MainTarget)

    # The address overlay hides native content. Reload starts a fresh page load;
    # close it and resize immediately so bounds and loading transitions overlap.
    $beforeToolbar = Get-MainDomState $MainTarget
    Assert-Condition (-not [bool]$beforeToolbar.addressOverlayVisible) "Address overlay was unexpectedly visible before its toggle."
    [void](Invoke-PhysicalDomClick $MainWindow $MainTarget "Toggle address bar" "aria")
    [void](Wait-DomState $MainTarget { param($s) $s.addressOverlayVisible } "address overlay to become visible")
    $transition.addressOverlayShown = $true
    Wait-NativeBrowserInactive $MainWindow
    [void](Wait-DomState $MainTarget { param($s) $s.reloadControl -eq "Reload" -and -not $s.loading } "the active Browser tab to settle before reload" 15000)
    [void](Invoke-PhysicalDomClick $MainWindow $MainTarget "Reload" "aria")
    [void](Wait-DomState $MainTarget { param($s) $s.reloadControl -eq "Stop" -and $s.loading } "reload to enter the loading state" 5000)
    $transition.reloadStarted = $true
    [void](Invoke-PhysicalDomClick $MainWindow $MainTarget "Close address bar" "aria")
    [void](Wait-DomState $MainTarget { param($s) -not $s.addressOverlayVisible } "address overlay to close")
    $transition.addressOverlayHidden = $true
    Start-Sleep -Milliseconds $TransitionDelayMs
    Invoke-PhysicalWindowResize $MainWindow (if (($Cycle % 2) -eq 0) { 28 } else { -28 })
    [void](Wait-NativeBrowserActive $MainWindow $MainTarget)
    [void](Wait-DomState $MainTarget { param($s) -not $s.loading } "reload to leave the loading state" 15000)
    $transition.reloadCompleted = $true

    # A physical shell click after the overlapped reload/resize must still work.
    # This is the user-visible regression: a stale native child swallowed it.
    Open-SettingsAbout $MainWindow $MainTarget
    Wait-NativeBrowserInactive $MainWindow
    $transition.passed = $true
    $report.transitions += $transition
    $coverage.passes = [int]$coverage.passes + 1
    $report.cyclesCompleted = $Cycle
    Add-PhaseEvidence -Name "cycle-$Cycle-complete" -MainWindow $MainWindow -MainTarget $MainTarget
}

function Invoke-StartupPreparation {
    param([IntPtr]$MainWindow, $MainTarget)
    Add-PhaseEvidence -Name "preparation-$($PreparationMode.ToLowerInvariant())-before" -MainWindow $MainWindow -MainTarget $MainTarget
    switch ($PreparationMode) {
        "Passive" {
            # Diagnostic default: observe the app exactly as it launched. Do
            # not activate, restore, move, or resize the native window.
        }
        "FocusOnly" {
            Focus-MainWindow $MainWindow
            Assert-ExactMainForeground $MainWindow
        }
        "AsyncResizeOnly" {
            Set-MainWindowPlacementAsync $MainWindow -UseWorkArea -MainTarget $MainTarget
        }
        "LegacyFullPrep" {
            # Explicit reproduction mode for the previous harness behavior.
            [void][CovenNativeRegression.Win32]::ShowWindowAsync($MainWindow, $SW_RESTORE)
            Start-Sleep -Milliseconds 250
            Ensure-MainWindowWithinWorkArea $MainWindow -UseWorkArea
            Focus-MainWindow $MainWindow
            Assert-ExactMainForeground $MainWindow
        }
    }
    Add-PhaseEvidence -Name "preparation-$($PreparationMode.ToLowerInvariant())-after" -MainWindow $MainWindow -MainTarget $MainTarget
}

function Register-CloseListener {
    param($MainTarget)
    $result = Invoke-CdpExpression $MainTarget @'
(async () => {
  const listen = window.__TAURI__?.event?.listen;
  if (typeof listen !== 'function') return { registered: false };
  window.__covenNativeRegressionUnlisten = await listen('tauri://close-requested', () => {
    window.__covenNativeRegressionCloseEvents = (window.__covenNativeRegressionCloseEvents || 0) + 1;
  });
  return { registered: true };
})()
'@
    Assert-Condition ([bool]$result.registered) "Could not register the tauri://close-requested listener used by the stalled-renderer close probe."
}

function Start-BoundedCdpStall {
    param($Target, [int]$DurationMs)
    $socket = Open-CdpSocket ([string]$Target.webSocketDebuggerUrl) 3000
    $script:cdpId += 1
    $expression = "(() => { const end = performance.now() + $DurationMs; while (performance.now() < end) {} return true; })()"
    Send-CdpPayload $socket ([ordered]@{
        id = $script:cdpId
        method = "Runtime.evaluate"
        params = [ordered]@{ expression = $expression; returnByValue = $true }
    })
    return $socket
}

function Test-CdpTargetResponsive {
    param($Target, [int]$TimeoutMs = 750)
    try {
        $token = [Guid]::NewGuid().ToString("N")
        $tokenJson = $token | ConvertTo-Json -Compress
        $value = Invoke-CdpExpression $Target $tokenJson $TimeoutMs
        return [string]$value -eq $token
    }
    catch { return $false }
}

function Wait-CdpTargetUnresponsive {
    param($Target, [int]$TimeoutMs = 2500)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        if (-not (Test-CdpTargetResponsive $Target 250)) { return $true }
        Start-Sleep -Milliseconds 50
    } while ($watch.ElapsedMilliseconds -lt $TimeoutMs)
    return $false
}

$launchedProcess = $null
$mainWindow = [IntPtr]::Zero
$createdProfile = $false
$captured = @{}
$stallSockets = New-Object System.Collections.ArrayList
$cleanupFailure = $null

try {
    if ($AttachPid -eq 0) {
        [System.IO.Directory]::CreateDirectory($WebView2Profile) | Out-Null
        [System.IO.File]::WriteAllText(
            (Join-Path $WebView2Profile ".coven-native-regression-owner"),
            $profileMarkerContent,
            [System.Text.UTF8Encoding]::new($false)
        )
        $createdProfile = $true
        $report.isolation.profileCreatedByHarness = $true

        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $candidatePath
        $startInfo.WorkingDirectory = Split-Path -Parent $candidatePath
        $startInfo.UseShellExecute = $false
        $startInfo.EnvironmentVariables["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=$CdpPort"
        $startInfo.EnvironmentVariables["WEBVIEW2_USER_DATA_FOLDER"] = $WebView2Profile
        $launchedProcess = [Diagnostics.Process]::Start($startInfo)
        if ($null -eq $launchedProcess) { throw "Failed to launch exact candidate '$candidatePath'." }
        $appProcessId = $launchedProcess.Id
        $rootCim = Get-ProcessCimExact $appProcessId
        if ($null -eq $rootCim) { throw "Launched candidate PID $appProcessId disappeared before attribution." }
        Assert-Condition (Test-PathEqual ([string]$rootCim.ExecutablePath) $candidatePath) "Launched PID path does not match the exact candidate."
        $rootTuple = ConvertTo-ProcessTuple $rootCim $appProcessId
    }

    $report.candidate.processId = $appProcessId
    $report.candidate.creationTimeUtc = $rootTuple.creationTimeUtc
    $mainWindow = Wait-MainWindowHandle $appProcessId
    Add-PhaseEvidence -Name "main-window-discovered" -MainWindow $mainWindow
    # Do not touch window state just because the HWND exists. WRY/WebView2 can
    # still be creating its controller; external resize/activation in that
    # interval can produce a Windows Ghost even though CDP later comes alive.
    [void](Wait-CdpTargets $CdpPort)
    $mainTarget = Find-MainCdpTarget $CdpPort
    Add-PhaseEvidence -Name "cdp-main-target-discovered" -MainWindow $mainWindow -MainTarget $mainTarget
    Wait-MainRendererReady $mainTarget
    Add-PhaseEvidence -Name "main-renderer-ready" -MainWindow $mainWindow -MainTarget $mainTarget
    Wait-NativeMessagePump $mainWindow
    Add-PhaseEvidence -Name "native-message-pump-ready" -MainWindow $mainWindow -MainTarget $mainTarget
    Invoke-StartupPreparation $mainWindow $mainTarget
    Wait-NativeMessagePump $mainWindow
    $report.startupGeometry = Wait-StableMainGeometry $mainWindow $mainTarget 1000 20000
    Add-PhaseEvidence -Name "startup-geometry-stable" -MainWindow $mainWindow -MainTarget $mainTarget

    foreach ($tuple in @(Get-AttributedProcessTuples $appProcessId $rootTuple $WebView2Profile)) { $captured[(Get-TupleKey $tuple)] = $tuple }
    if ($WebView2Profile) {
        $webViewRows = @(Get-CimInstance Win32_Process | Where-Object {
            [int]$_.ProcessId -in @($captured.Values | Where-Object kind -eq "webview2" | ForEach-Object processId)
        })
        foreach ($row in $webViewRows) {
            Assert-Condition ([string]$row.CommandLine -like "*$WebView2Profile*") "WebView2 PID $($row.ProcessId) is not using the supplied unique profile."
        }
    }

    if ($StartupProbeOnly) {
        $report.processSnapshot = @($captured.Values | Sort-Object processId, creationTimeUtcTicks)
        Add-PhaseEvidence -Name "startup-probe-complete" -MainWindow $mainWindow -MainTarget $mainTarget
        $report.status = "passed-startup-probe"
        Write-RegressionReport
        Write-Host "Startup health and stable geometry probe passed; no stress input or close was attempted."
        Write-Host "Report: $OutputPath"
        return
    }

    if ($StartTrustedPty) {
        $newPtyTuple = Start-TrustedPtyForRegression $mainTarget $appProcessId $rootTuple $WebView2Profile
        $captured[(Get-TupleKey $newPtyTuple)] = $newPtyTuple
        Add-PhaseEvidence -Name "trusted-pty-started" -MainWindow $mainWindow -MainTarget $mainTarget
    }

    for ($cycle = 1; $cycle -le $Cycles; $cycle += 1) {
        $link = $settingsLinks[($cycle - 1) % $settingsLinks.Count]
        Invoke-OneStressCycle $mainWindow $mainTarget $link $cycle
    }

    if (-not $PartialCoverage) {
        foreach ($coverage in $linkCoverage) {
            Assert-Condition ([int]$coverage.passes -ge 2) (
                "Full regression coverage failed for $($coverage.label): expected at least 2 passing cycles, observed $($coverage.passes)."
            )
        }
    }

    # Finish on a live child page so close is tested with both renderers stalled.
    Open-SettingsAbout $mainWindow $mainTarget
    Invoke-PhysicalDomClick $mainWindow $mainTarget "GitHub" "text"
    [void](Wait-DomState $mainTarget { param($s) $s.hasViewport -and $s.address -eq $settingsLinks[0].href } "final Browser navigation" 7000)
    [void](Wait-NativeBrowserActive $mainWindow $mainTarget)
    $finalChildUrl = Wait-ActiveChildUrl $CdpPort $mainTarget $settingsLinks[0] 10000
    $finalChildTarget = $finalChildUrl.target

    foreach ($tuple in @(Get-AttributedProcessTuples $appProcessId $rootTuple $WebView2Profile)) { $captured[(Get-TupleKey $tuple)] = $tuple }
    $report.processSnapshot = @($captured.Values | Sort-Object processId, creationTimeUtcTicks)
    Assert-Condition (@($report.processSnapshot | Where-Object kind -eq "webview2").Count -gt 0) "No owned WebView2 descendant was captured."
    if ($ExpectPackagedSidecar) {
        Assert-Condition (@($report.processSnapshot | Where-Object kind -eq "node").Count -gt 0) "-ExpectPackagedSidecar was set but no owned Node descendant was captured."
    }
    if ($ExpectPtyDescendant) {
        Assert-Condition (@($report.processSnapshot | Where-Object kind -eq "pty").Count -gt 0) "-ExpectPtyDescendant was set but no owned PTY descendant was captured."
    }

    if ($SkipClose) {
        Add-PhaseEvidence -Name "stress-complete-close-skipped" -MainWindow $mainWindow -MainTarget $mainTarget
        $report.status = "passed-with-close-skipped"
        Write-RegressionReport
        Write-Host "Native Browser stress checks passed; close was intentionally skipped."
        Write-Host "Report: $OutputPath"
        return
    }

    Register-CloseListener $mainTarget
    $childTarget = $finalChildTarget
    Add-PhaseEvidence -Name "before-renderer-stalls" -MainWindow $mainWindow -MainTarget $mainTarget
    Assert-Condition (Test-CdpTargetResponsive $childTarget 750) "Child Browser CDP target was not responsive before the bounded stall."
    Assert-Condition (Test-CdpTargetResponsive $mainTarget 750) "Main renderer CDP target was not responsive before the bounded stall."
    $childStallEvidence = [ordered]@{
        role = "native-browser-child"; targetId = [string]$childTarget.id
        baselineResponsive = $true; commandSentAtUtc = [DateTime]::UtcNow.ToString("o")
        commandSent = $false; unresponsiveBeforeClose = $false
    }
    $mainStallEvidence = [ordered]@{
        role = "main-renderer"; targetId = [string]$mainTarget.id
        baselineResponsive = $true; commandSentAtUtc = $null
        commandSent = $false; unresponsiveBeforeClose = $false
    }
    $report.stalls += $childStallEvidence
    $report.stalls += $mainStallEvidence
    [void]$stallSockets.Add((Start-BoundedCdpStall $childTarget $RendererStallMs))
    $childStallEvidence.commandSent = $true
    $mainStallEvidence.commandSentAtUtc = [DateTime]::UtcNow.ToString("o")
    [void]$stallSockets.Add((Start-BoundedCdpStall $mainTarget $RendererStallMs))
    $mainStallEvidence.commandSent = $true
    Start-Sleep -Milliseconds 100
    $childStallEvidence.unresponsiveBeforeClose = Wait-CdpTargetUnresponsive $childTarget 2500
    $mainStallEvidence.unresponsiveBeforeClose = Wait-CdpTargetUnresponsive $mainTarget 2500
    Assert-Condition ([bool]$childStallEvidence.unresponsiveBeforeClose) "Child Browser renderer did not enter the commanded bounded stall before WM_CLOSE."
    Assert-Condition ([bool]$mainStallEvidence.unresponsiveBeforeClose) "Main renderer did not enter the commanded bounded stall before WM_CLOSE."
    # Re-probe immediately before posting WM_CLOSE so the report proves both
    # renderers were still unresponsive at the native-close boundary.
    Assert-Condition (-not (Test-CdpTargetResponsive $childTarget 250)) "Child Browser renderer resumed before WM_CLOSE was posted."
    Assert-Condition (-not (Test-CdpTargetResponsive $mainTarget 250)) "Main renderer resumed before WM_CLOSE was posted."
    Add-PhaseEvidence -Name "both-renderers-stalled" -MainWindow $mainWindow

    $report.close.posted = $true
    $closeWatch = [Diagnostics.Stopwatch]::StartNew()
    Assert-Condition ([CovenNativeRegression.Win32]::PostMessage($mainWindow, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)) "Posting WM_CLOSE to the exact main HWND failed."

    do {
        foreach ($tuple in @(Get-AttributedProcessTuples $appProcessId $rootTuple $WebView2Profile)) { $captured[(Get-TupleKey $tuple)] = $tuple }
        if (-not (Test-ProcessTupleAlive $rootTuple)) { break }
        Start-Sleep -Milliseconds 25
    } while ($closeWatch.ElapsedMilliseconds -lt $CloseDeadlineMs)

    $report.close.elapsedMilliseconds = $closeWatch.ElapsedMilliseconds
    $report.close.withinDeadline = -not (Test-ProcessTupleAlive $rootTuple)
    Assert-Condition ([bool]$report.close.withinDeadline) (
        "Candidate did not exit within ${CloseDeadlineMs}ms after WM_CLOSE while JavaScript was stalled. It was not force-terminated."
    )

    $report.processSnapshot = @($captured.Values | Sort-Object processId, creationTimeUtcTicks)
    $postWatch = [Diagnostics.Stopwatch]::StartNew()
    $survivors = @()
    do {
        foreach ($tuple in @(Get-AttributedProcessTuples $appProcessId $rootTuple $WebView2Profile)) { $captured[(Get-TupleKey $tuple)] = $tuple }
        $report.processSnapshot = @($captured.Values | Sort-Object processId, creationTimeUtcTicks)
        $survivors = @($report.processSnapshot | Where-Object { Test-ProcessTupleAlive $_ })
        if ($survivors.Count -eq 0) { break }
        Start-Sleep -Milliseconds 50
    } while ($postWatch.ElapsedMilliseconds -lt $PostExitDeadlineMs)

    $report.orphanCheck.performed = $true
    $report.orphanCheck.survivingTuples = $survivors
    $report.orphanCheck.passed = $survivors.Count -eq 0
    Assert-Condition ([bool]$report.orphanCheck.passed) (
        "Owned PID+creation tuples survived exit: " + (($survivors | ForEach-Object { "$($_.processId)|$($_.creationTimeUtcTicks)|$($_.kind)" }) -join ", ")
    )

    Add-PhaseEvidence -Name "close-and-orphan-check-complete"
    $report.status = "passed-pending-profile-cleanup"
    Write-RegressionReport
}
catch {
    $report.status = "failed"
    $report.failure = $_.Exception.Message
    try { Add-PhaseEvidence -Name "failure" -MainWindow $mainWindow } catch { }
    if ($captured.Count -gt 0) { $report.processSnapshot = @($captured.Values | Sort-Object processId, creationTimeUtcTicks) }
    Write-RegressionReport
    throw
}
finally {
    try {
        foreach ($socket in $stallSockets) {
            try { $socket.Dispose() } catch { }
        }
        # Only remove an isolated profile created by this run, and only after the
        # exact app tuple has exited. No installed application/user profile is used.
        if ($createdProfile -and $null -ne $rootTuple -and -not (Test-ProcessTupleAlive $rootTuple)) {
            $report.isolation.profileCleanup.eligible = $true
            $report.isolation.profileCleanup.attempted = $true
            try {
                $marker = Join-Path $WebView2Profile ".coven-native-regression-owner"
                $tempRoot = (Get-FullPath ([System.IO.Path]::GetTempPath())).TrimEnd(
                    [System.IO.Path]::DirectorySeparatorChar,
                    [System.IO.Path]::AltDirectorySeparatorChar
                )
                $tempBoundary = $tempRoot + [System.IO.Path]::DirectorySeparatorChar
                $profileFull = Get-FullPath $WebView2Profile
                Assert-Condition (
                    -not $profileFull.Equals($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
                    $profileFull.StartsWith($tempBoundary, [StringComparison]::OrdinalIgnoreCase)
                ) "Run-owned profile is not a strict child of the Windows temp directory; refusing recursive cleanup."
                Assert-Condition (Test-Path -LiteralPath $marker -PathType Leaf) "Run-owned profile marker is missing; refusing recursive cleanup."
                $actualMarkerContent = [System.IO.File]::ReadAllText($marker)
                Assert-Condition ($actualMarkerContent -ceq $profileMarkerContent) "Run-owned profile marker content does not match this exact harness invocation; refusing recursive cleanup."
                Remove-Item -LiteralPath $profileFull -Recurse -Force -ErrorAction Stop
                Assert-Condition (-not (Test-Path -LiteralPath $profileFull)) "Run-owned profile still exists after recursive cleanup."
                $report.isolation.profileCleanup.passed = $true
                if ([string]$report.status -eq "passed-pending-profile-cleanup") {
                    $report.status = "passed"
                }
            }
            catch {
                $cleanupFailure = "Run-owned WebView2 profile cleanup failed: $($_.Exception.Message)"
                $report.isolation.profileCleanup.passed = $false
                $report.isolation.profileCleanup.error = $cleanupFailure
                if ([string]$report.status -like "passed*") {
                    $report.status = "failed"
                    $report.failure = $cleanupFailure
                }
            }
        }
        elseif ([string]$report.status -eq "passed-pending-profile-cleanup") {
            # Attach mode did not create a profile, so there is no harness-owned
            # filesystem cleanup gate for this passing run.
            $report.status = "passed"
        }
    }
    finally {
        # SetThreadDpiAwarenessContext is thread-scoped. Always restore the
        # context inherited by PowerShell, even if diagnostic cleanup fails.
        try {
            $restoreResult = [CovenNativeRegression.Win32]::SetThreadDpiAwarenessContext($previousDpiContext)
            $report.isolation.dpiAwarenessRestored = $restoreResult -ne [IntPtr]::Zero
        }
        catch {
            $report.isolation.dpiAwarenessRestored = $false
        }
        try { Write-RegressionReport } catch { }
    }
    if ($cleanupFailure -and [string]$report.status -eq "failed" -and [string]$report.failure -eq $cleanupFailure) {
        throw $cleanupFailure
    }
    if ([string]$report.status -eq "passed") {
        Write-Host "Windows native Browser regression passed ($Cycles cycles, close $($report.close.elapsedMilliseconds)ms, no owned orphans)."
        Write-Host "Report: $OutputPath"
    }
}
