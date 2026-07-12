param(
  [Parameter(Mandatory = $true)][string]$CurrentMsi,
  [Parameter(Mandatory = $true)][string]$CurrentTag,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [ValidateRange(30, 1800)][int]$MaxSeconds = 300
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-GhJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $output = & gh @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
  return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Find-CovenExecutable {
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "CovenCave\CovenCave.exe") }
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} "CovenCave\CovenCave.exe") }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }

  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }) {
    $found = Get-ChildItem -LiteralPath $root -Filter "CovenCave.exe" -Recurse -File -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($null -ne $found) { return $found.FullName }
  }
  throw "CovenCave.exe was not found under Program Files after MSI install"
}

function Get-BundledNodeChildren {
  param([Parameter(Mandatory = $true)][int]$AppProcessId)
  return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.ParentProcessId -eq $AppProcessId -and
      $_.ExecutablePath -match '[\\/]resources[\\/]node[\\/]bin[\\/]node\.exe$'
    })
}

function Wait-BundledNode {
  param(
    [Parameter(Mandatory = $true)][int]$AppProcessId,
    [int]$TimeoutSeconds = 30
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $children = @(Get-BundledNodeChildren $AppProcessId)
    if ($children.Count -gt 0) { return $children }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "No bundled resources\node\bin\node.exe child appeared for app PID $AppProcessId"
}

function Stop-AppGracefully {
  param(
    [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Process.HasExited) { return }
  if (-not $Process.CloseMainWindow()) { throw "$Label has no closeable main window" }
  if (-not $Process.WaitForExit(30 * 1000)) {
    throw "$Label did not exit within 30 seconds after CloseMainWindow"
  }
}

function Assert-ProcessesGone {
  param([Parameter(Mandatory = $true)][int[]]$ProcessIds)
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $remaining = @($ProcessIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Old CovenCave/Node processes survived upgrade: $($remaining -join ', ')"
}

function Wait-SidecarReadyLog {
  param([Parameter(Mandatory = $true)][string]$Path, [int]$TimeoutSeconds = 30)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path -LiteralPath $Path) {
      $content = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
      if ($content -match 'Ready on http://') { return }
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Post-upgrade sidecar log did not contain 'Ready on http://' within $TimeoutSeconds seconds: $Path"
}

function Stop-RecordedProcesses {
  param([object[]]$Records)
  foreach ($record in @($Records)) {
    if ($null -eq $record -or $null -eq $record.processId) { continue }
    Stop-Process -Id ([int]$record.processId) -Force -ErrorAction SilentlyContinue
  }
}

$resolvedCurrentMsi = (Resolve-Path -LiteralPath $CurrentMsi).Path
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$resultPath = Join-Path $outputRoot "windows-upgrade-result.json"
$previousLog = Join-Path $outputRoot "previous-install.log"
$upgradeLog = Join-Path $outputRoot "current-upgrade.log"
$cleanupLog = Join-Path $outputRoot "cleanup-uninstall.log"
$sidecarLog = Join-Path $env:APPDATA "CovenCave\logs\sidecar.log"
$repo = if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { "OpenCoven/coven-cave" }
$started = [DateTime]::UtcNow
$oldApp = $null
$newApp = $null
$previousMsi = $null
$previousDirectory = $null
$installationStarted = $false
$failure = $null
$result = [ordered]@{
  skipped = $false
  reason = $null
  repository = $repo
  currentTag = $CurrentTag
  currentMsi = $resolvedCurrentMsi
  previousTag = $null
  previousMsi = $null
  maxSeconds = $MaxSeconds
  startedAt = $started.ToString("o")
  completedAt = $null
  upgradeMilliseconds = $null
  installerExitCode = $null
  processes = [ordered]@{
    oldApp = $null
    oldNodes = @()
    newApp = $null
    newNodes = @()
  }
  logs = [ordered]@{
    previousInstall = $previousLog
    currentUpgrade = $upgradeLog
    cleanup = $cleanupLog
    sidecar = (Join-Path $outputRoot "post-upgrade-sidecar.log")
  }
  error = $null
}

try {
  $releases = @(Invoke-GhJson @("release", "list", "--repo", $repo, "--limit", "100", "--json", "tagName,isDraft,isPrerelease,publishedAt")) |
    Where-Object { -not $_.IsDraft -and -not $_.IsPrerelease -and $_.TagName -ne $CurrentTag } |
    Sort-Object { [DateTime]$_.PublishedAt } -Descending

  $previousRelease = $null
  $previousAsset = $null
  foreach ($release in $releases) {
    $releaseData = Invoke-GhJson @("api", "repos/$repo/releases/tags/$($release.TagName)")
    $asset = @($releaseData.assets | Where-Object { $_.name -match '\.msi$' }) | Select-Object -First 1
    if ($null -ne $asset) {
      $previousRelease = $release
      $previousAsset = $asset
      break
    }
  }
  if ($null -eq $previousRelease) {
    $result.skipped = $true
    $result.reason = "no-previous-msi"
    Write-Host "No earlier stable release contains an MSI; upgrade smoke skipped."
    return
  }

  $result.previousTag = $previousRelease.TagName
  $previousDirectory = Join-Path $outputRoot "previous-msi"
  New-Item -ItemType Directory -Force -Path $previousDirectory | Out-Null
  # Download exactly the discovered previous *.msi release asset.
  $downloadOutput = & gh release download $previousRelease.TagName --repo $repo --dir $previousDirectory --pattern $previousAsset.name --clobber 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh release download failed: $($downloadOutput -join [Environment]::NewLine)" }
  $previousMsi = Join-Path $previousDirectory $previousAsset.name
  if (-not (Test-Path -LiteralPath $previousMsi)) { throw "Downloaded previous MSI is missing: $previousMsi" }
  $result.previousMsi = $previousMsi

  $previousInstallArgs = @("/i", "`"$previousMsi`"", "/qn", "/norestart", "/L*V", "`"$previousLog`"")
  $installationStarted = $true
  $previousInstaller = Start-Process -FilePath "msiexec.exe" -ArgumentList $previousInstallArgs -PassThru
  if (-not $previousInstaller.WaitForExit($MaxSeconds * 1000)) {
    Stop-Process -Id $previousInstaller.Id -Force -ErrorAction SilentlyContinue
    throw "Previous MSI install exceeded $MaxSeconds seconds"
  }
  if ($previousInstaller.ExitCode -ne 0) { throw "Previous MSI install failed with exit code $($previousInstaller.ExitCode)" }

  $oldExecutable = Find-CovenExecutable
  $oldApp = Start-Process -FilePath $oldExecutable -PassThru
  $oldNodes = @(Wait-BundledNode $oldApp.Id)
  $result.processes.oldApp = [ordered]@{ processId = $oldApp.Id; executablePath = $oldExecutable }
  $result.processes.oldNodes = @($oldNodes | ForEach-Object {
    [ordered]@{ processId = [int]$_.ProcessId; parentProcessId = [int]$_.ParentProcessId; executablePath = $_.ExecutablePath }
  })

  Stop-AppGracefully $oldApp "previous CovenCave"
  $upgradeStarted = [DateTime]::UtcNow
  $currentUpgradeArgs = @("/i", "`"$resolvedCurrentMsi`"", "/qn", "/norestart", "/L*V", "`"$upgradeLog`"")
  Write-Host "Starting current upgrade with msiexec.exe /L*V (limit: $MaxSeconds seconds)"
  $upgrade = Start-Process -FilePath "msiexec.exe" -ArgumentList $currentUpgradeArgs -PassThru
  if (-not $upgrade.WaitForExit($MaxSeconds * 1000)) {
    Stop-Process -Id $upgrade.Id -Force -ErrorAction SilentlyContinue
    throw "Current MSI upgrade exceeded $MaxSeconds seconds"
  }
  $result.upgradeMilliseconds = [int64]([DateTime]::UtcNow - $upgradeStarted).TotalMilliseconds
  $result.installerExitCode = $upgrade.ExitCode
  if ($upgrade.ExitCode -ne 0) {
    throw "Current MSI upgrade failed with exit code $($upgrade.ExitCode); reboot-required 3010 is not accepted"
  }
  $oldProcessIds = @($result.processes.oldApp.processId) + @($result.processes.oldNodes | ForEach-Object { $_.processId })
  Assert-ProcessesGone $oldProcessIds

  $newExecutable = Find-CovenExecutable
  $newApp = Start-Process -FilePath $newExecutable -PassThru
  $newNodes = @(Wait-BundledNode $newApp.Id)
  Wait-SidecarReadyLog $sidecarLog 30
  $result.processes.newApp = [ordered]@{ processId = $newApp.Id; executablePath = $newExecutable }
  $result.processes.newNodes = @($newNodes | ForEach-Object {
    [ordered]@{ processId = [int]$_.ProcessId; parentProcessId = [int]$_.ParentProcessId; executablePath = $_.ExecutablePath }
  })
  Copy-Item -LiteralPath $sidecarLog -Destination $result.logs.sidecar -Force
}
catch {
  $failure = $_
  $result.error = $_.Exception.Message
}
finally {
  if ($null -ne $newApp -and -not $newApp.HasExited) {
    try { Stop-AppGracefully $newApp "current CovenCave" } catch { Stop-Process -Id $newApp.Id -Force -ErrorAction SilentlyContinue }
  }
  if ($null -ne $oldApp -and -not $oldApp.HasExited) {
    try { Stop-AppGracefully $oldApp "previous CovenCave" } catch { Stop-Process -Id $oldApp.Id -Force -ErrorAction SilentlyContinue }
  }
  Stop-RecordedProcesses @($result.processes.newNodes)
  Stop-RecordedProcesses @($result.processes.oldNodes)

  if ($installationStarted) {
    try {
      $cleanupArgs = @("/x", "`"$resolvedCurrentMsi`"", "/qn", "/norestart", "/L*V", "`"$cleanupLog`"")
      $cleanup = Start-Process -FilePath "msiexec.exe" -ArgumentList $cleanupArgs -Wait -PassThru
      if ($cleanup.ExitCode -ne 0 -and $null -ne $previousMsi) {
        $cleanupArgs = @("/x", "`"$previousMsi`"", "/qn", "/norestart", "/L*V", "`"$cleanupLog`"")
        [void](Start-Process -FilePath "msiexec.exe" -ArgumentList $cleanupArgs -Wait -PassThru)
      }
    }
    catch {
      Write-Warning "Cleanup uninstall failed: $($_.Exception.Message)"
    }
  }
  if ($null -ne $previousDirectory) {
    Remove-Item -LiteralPath $previousDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }

  if ((Test-Path -LiteralPath $sidecarLog) -and -not (Test-Path -LiteralPath $result.logs.sidecar)) {
    Copy-Item -LiteralPath $sidecarLog -Destination $result.logs.sidecar -Force -ErrorAction SilentlyContinue
  }
  $result.completedAt = [DateTime]::UtcNow.ToString("o")
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
  Write-Host "Windows upgrade evidence written to $resultPath"
}

if ($null -ne $failure) { throw $failure }
