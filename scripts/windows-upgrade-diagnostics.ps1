[CmdletBinding(DefaultParameterSetName = "Local")]
param(
    [Parameter(Mandatory = $true, ParameterSetName = "Local")]
    [string]$CandidateMsiPath,

    [Parameter(Mandatory = $true, ParameterSetName = "Url")]
    [string]$CandidateUrl,

    [Parameter(Mandatory = $true, ParameterSetName = "Fixture")]
    [string]$FixturePath,

    [string]$OutputDirectory = "windows-upgrade-diagnostics",
    [string]$ExpectedFromVersion,
    [string]$ExpectedToVersion,
    [ValidateRange(1, 240)]
    [int]$TimeoutMinutes = 60,
    [ValidateRange(1, 60)]
    [int]$SampleIntervalSeconds = 5,
    [ValidateRange(10, 900)]
    [int]$ReadyTimeoutSeconds = 300,
    [string]$LaunchPath,
    [switch]$AllowInstall,
    [switch]$SkipReadiness
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function ConvertTo-RedactedText {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) {
        return $null
    }
    $redacted = $Text
    $redacted = $redacted -replace '(?i)(covenCaveToken=)[^&\s"'']+', '$1[REDACTED]'
    $redacted = $redacted -replace '(?i)(coven_access_token=)[^&\s"'']+', '$1[REDACTED]'
    $redacted = $redacted -replace '(?i)(COVEN_CAVE_(?:SIDECAR|ACCESS)_TOKEN[=:]\s*)[^\s"'']+', '$1[REDACTED]'
    return $redacted
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $json = $Value | ConvertTo-Json -Depth 16
    $temporaryPath = "$Path.tmp"
    [System.IO.File]::WriteAllText($temporaryPath, "$json`n", [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Value -is [System.Collections.IDictionary]) {
        if ($Value.Contains($Name)) {
            return $Value[$Name]
        }
        return $null
    }

    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-MsiMetadata {
    param([Parameter(Mandatory = $true)][string]$Path)

    $installer = $null
    $database = $null
    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.GetType().InvokeMember(
            "OpenDatabase",
            [System.Reflection.BindingFlags]::InvokeMethod,
            $null,
            $installer,
            @($Path, 0)
        )
        $properties = [ordered]@{}
        foreach ($propertyName in @("ProductName", "ProductVersion", "ProductCode", "UpgradeCode")) {
            $view = $null
            $record = $null
            try {
                $query = "SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$propertyName'"
                $view = $database.GetType().InvokeMember(
                    "OpenView",
                    [System.Reflection.BindingFlags]::InvokeMethod,
                    $null,
                    $database,
                    @($query)
                )
                $view.GetType().InvokeMember(
                    "Execute",
                    [System.Reflection.BindingFlags]::InvokeMethod,
                    $null,
                    $view,
                    $null
                ) | Out-Null
                $record = $view.GetType().InvokeMember(
                    "Fetch",
                    [System.Reflection.BindingFlags]::InvokeMethod,
                    $null,
                    $view,
                    $null
                )
                $properties[$propertyName] = if ($null -eq $record) {
                    $null
                }
                else {
                    $record.GetType().InvokeMember(
                        "StringData",
                        [System.Reflection.BindingFlags]::GetProperty,
                        $null,
                        $record,
                        @(1)
                    )
                }
            }
            finally {
                if ($null -ne $record) {
                    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
                }
                if ($null -ne $view) {
                    $view.GetType().InvokeMember(
                        "Close",
                        [System.Reflection.BindingFlags]::InvokeMethod,
                        $null,
                        $view,
                        $null
                    ) | Out-Null
                    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
                }
            }
        }
        return [ordered]@{
            source = $Path
            path = $Path
            sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
            bytes = (Get-Item -LiteralPath $Path).Length
            productName = $properties.ProductName
            productVersion = $properties.ProductVersion
            productCode = $properties.ProductCode
            upgradeCode = $properties.UpgradeCode
        }
    }
    finally {
        if ($null -ne $database) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
        }
        if ($null -ne $installer) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
        }
    }
}

function Get-InstalledCovenCaveRecord {
    $records = @()
    foreach ($root in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )) {
        $records += @(Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object {
            (Get-OptionalProperty -Value $_ -Name "DisplayName") -eq "CovenCave"
        })
    }
    $record = $records | Sort-Object -Property @{
        Expression = {
            try {
                [Version](Get-OptionalProperty -Value $_ -Name "DisplayVersion")
            }
            catch {
                [Version]"0.0.0"
            }
        }
        Descending = $true
    } | Select-Object -First 1
    if ($null -eq $record) {
        return $null
    }
    return [ordered]@{
        displayName = Get-OptionalProperty -Value $record -Name "DisplayName"
        version = Get-OptionalProperty -Value $record -Name "DisplayVersion"
        installLocation = Get-OptionalProperty -Value $record -Name "InstallLocation"
        displayIcon = Get-OptionalProperty -Value $record -Name "DisplayIcon"
        uninstallString = ConvertTo-RedactedText -Text (Get-OptionalProperty -Value $record -Name "UninstallString")
    }
}

function Get-AllProcesses {
    return @(Get-CimInstance -ClassName Win32_Process | Select-Object `
        ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate, `
        KernelModeTime, UserModeTime, ReadTransferCount, WriteTransferCount)
}

function Get-DescendantIds {
    param(
        [Parameter(Mandatory = $true)]$Processes,
        [Parameter(Mandatory = $true)][int[]]$RootIds
    )

    $selected = @($RootIds | Select-Object -Unique)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $Processes) {
            $id = [int]$process.ProcessId
            if (($selected -contains [int]$process.ParentProcessId) -and -not ($selected -contains $id)) {
                $selected += $id
                $changed = $true
            }
        }
    }
    return @($selected)
}

function ConvertTo-ProcessRecord {
    param([Parameter(Mandatory = $true)]$Process)

    return [ordered]@{
        processId = [int]$Process.ProcessId
        parentProcessId = [int]$Process.ParentProcessId
        name = $Process.Name
        executablePath = $Process.ExecutablePath
        commandLine = ConvertTo-RedactedText -Text $Process.CommandLine
        creationDate = if ($null -eq $Process.CreationDate) { $null } else { ([DateTimeOffset]$Process.CreationDate).ToUniversalTime().ToString("o") }
    }
}

function Test-SameExecutablePath {
    param(
        [AllowNull()][string]$Left,
        [AllowNull()][string]$Right
    )

    if (-not $Left -or -not $Right) {
        return $false
    }
    try {
        $normalizedLeft = [System.IO.Path]::GetFullPath(($Left -replace '^\\\\\?\\', ''))
        $normalizedRight = [System.IO.Path]::GetFullPath(($Right -replace '^\\\\\?\\', ''))
        return $normalizedLeft.Equals($normalizedRight, [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-ApplicationRootIds {
    param(
        [Parameter(Mandatory = $true)]$Processes,
        [Parameter(Mandatory = $true)][string]$Executable
    )

    return @($Processes | Where-Object {
        Test-SameExecutablePath -Left $_.ExecutablePath -Right $Executable
    } | ForEach-Object { [int]$_.ProcessId })
}

function Get-CovenProcessSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [int[]]$TrackedProcessIds = @()
    )

    $processes = Get-AllProcesses
    $rootIds = @(Get-ApplicationRootIds -Processes $processes -Executable $Executable)
    $selectedIds = @($TrackedProcessIds | Select-Object -Unique)
    if ($rootIds.Count -gt 0) {
        $selectedIds += Get-DescendantIds -Processes $processes -RootIds $rootIds
    }
    $selectedIds = @($selectedIds | Select-Object -Unique)
    if ($selectedIds.Count -eq 0) {
        return @()
    }
    return @($processes | Where-Object { $selectedIds -contains [int]$_.ProcessId } | ForEach-Object {
        ConvertTo-ProcessRecord -Process $_
    })
}

function Get-InstallerPerformanceSample {
    param(
        [Parameter(Mandatory = $true)][int]$ClientProcessId,
        [Parameter(Mandatory = $true)][DateTimeOffset]$TransactionStartedAt
    )

    $processes = Get-AllProcesses
    $descendantIds = Get-DescendantIds -Processes $processes -RootIds @($ClientProcessId)
    # Windows Installer normally transfers work from the launched client to a
    # service-hosted msiexec process. The live path refuses to start while any
    # msiexec already exists, so every installer process created after this
    # transaction began belongs to this measurement.
    $newInstallers = @($processes | Where-Object {
        if ($_.Name -ine "msiexec.exe") {
            return $false
        }
        $created = if ($null -eq $_.CreationDate) { $null } else { [DateTimeOffset]$_.CreationDate }
        return $descendantIds -contains [int]$_.ProcessId -or (
            $null -ne $created -and $created -ge $TransactionStartedAt.AddSeconds(-1)
        )
    })
    $installers = @($newInstallers | Where-Object {
        $descendantIds -contains [int]$_.ProcessId -or
        $_.CommandLine -match '(?i)\bmsiexec(?:\.exe)?"?\s+/V\b'
    })
    $unattributed = @($newInstallers | Where-Object {
        $candidateId = [int]$_.ProcessId
        -not @($installers | Where-Object { [int]$_.ProcessId -eq $candidateId }).Count
    })
    [long]$cpu100ns = 0
    [long]$readBytes = 0
    [long]$writeBytes = 0
    foreach ($process in $installers) {
        $cpu100ns += [long]$process.KernelModeTime + [long]$process.UserModeTime
        $readBytes += [long]$process.ReadTransferCount
        $writeBytes += [long]$process.WriteTransferCount
    }
    return [ordered]@{
        capturedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
        clientProcessId = $ClientProcessId
        processIds = @($installers | ForEach-Object { [int]$_.ProcessId })
        processes = @($installers | ForEach-Object {
            [ordered]@{
                processId = [int]$_.ProcessId
                parentProcessId = [int]$_.ParentProcessId
                relationship = if ([int]$_.ProcessId -eq $ClientProcessId) {
                    "launched-client"
                }
                elseif ($descendantIds -contains [int]$_.ProcessId) {
                    "client-descendant"
                }
                else {
                    "transaction-service"
                }
                commandLine = ConvertTo-RedactedText -Text $_.CommandLine
                creationDate = if ($null -eq $_.CreationDate) { $null } else { ([DateTimeOffset]$_.CreationDate).ToUniversalTime().ToString("o") }
                cpuMilliseconds = [math]::Round(([long]$_.KernelModeTime + [long]$_.UserModeTime) / 10000.0, 3)
                readBytes = [long]$_.ReadTransferCount
                writeBytes = [long]$_.WriteTransferCount
            }
        })
        unattributedProcesses = @($unattributed | ForEach-Object {
            ConvertTo-ProcessRecord -Process $_
        })
        cpuMilliseconds = [math]::Round($cpu100ns / 10000.0, 3)
        readBytes = $readBytes
        writeBytes = $writeBytes
    }
}

function Get-UpgradeAcceptance {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$BeforeProcesses,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$AfterInstallerProcesses,
        [Parameter(Mandatory = $true)]$Events,
        [Parameter(Mandatory = $true)]$MsiLog,
        [AllowNull()][object]$InstallerExitCode
    )

    $beforeSidecarIds = @($BeforeProcesses | Where-Object { $_.name -ieq "node.exe" } | ForEach-Object { [int]$_.processId })
    $orphanedSidecarIds = @($AfterInstallerProcesses | Where-Object {
        $_.name -ieq "node.exe" -and $beforeSidecarIds -contains [int]$_.processId
    } | ForEach-Object { [int]$_.processId })
    $rebootPattern = '(?i)(restart|reboot).{0,40}(required|necessary|initiated|scheduled)|(required|necessary).{0,40}(restart|reboot)'
    $rebootWarningEvidence = @()
    if ($InstallerExitCode -in @(1641, 3010)) {
        $rebootWarningEvidence += [ordered]@{
            source = "installer-exit-code"
            exitCode = [int]$InstallerExitCode
        }
    }
    $rebootWarningEvidence += @($Events.restartManager | Where-Object {
        (Get-OptionalProperty -Value $_ -Name "id") -eq 10005 -or
        (Get-OptionalProperty -Value $_ -Name "message") -match $rebootPattern
    })
    $rebootWarningEvidence += @($MsiLog.restartManagerEvidence | Where-Object {
        $_ -match $rebootPattern
    })
    return [ordered]@{
        orphanedSidecarProcessIds = $orphanedSidecarIds
        noOrphanedSidecar = $orphanedSidecarIds.Count -eq 0
        rebootWarningEvidence = $rebootWarningEvidence
        noRebootWarning = $rebootWarningEvidence.Count -eq 0
    }
}

function Get-MsiLogEvidence {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{
            path = $Path
            exists = $false
            bytes = 0
            sha256 = $null
            actions = @()
            completionEvidence = @()
            restartManagerEvidence = @()
            errors = @()
        }
    }

    $actions = @()
    $completion = @()
    $restartManager = @()
    $errors = @()
    try {
        foreach ($line in Get-Content -LiteralPath $Path -ErrorAction Stop) {
            if ($line -match 'Action (start|ended) (?<time>\d{2}:\d{2}:\d{2}):\s*(?<action>[^.]+)\.?(?: Return value (?<return>\d+)\.)?') {
                $actions += [ordered]@{
                    phase = $Matches[1]
                    clockTime = $Matches.time
                    action = $Matches.action.Trim()
                    returnValue = if ($Matches.ContainsKey("return") -and $Matches.return) { [int]$Matches.return } else { $null }
                    line = ConvertTo-RedactedText -Text $line
                }
            }
            if ($line -match 'MainEngineThread is returning 0|Installation operation completed successfully|Installation completed successfully') {
                $completion += ConvertTo-RedactedText -Text $line
            }
            if ($line -match '(?i)Restart Manager|RM session|RMSession|RMShutdown') {
                $restartManager += ConvertTo-RedactedText -Text $line
            }
            if ($line -match 'Return value 3|(?i)error\s+1[0-9]{3}|MainEngineThread is returning [1-9]') {
                $errors += ConvertTo-RedactedText -Text $line
            }
        }
    }
    catch {
        return [ordered]@{
            path = $Path
            exists = $true
            bytes = (Get-Item -LiteralPath $Path).Length
            sha256 = $null
            actions = @()
            completionEvidence = @()
            restartManagerEvidence = @()
            errors = @()
            readError = $_.Exception.Message
        }
    }
    return [ordered]@{
        path = $Path
        exists = $true
        bytes = (Get-Item -LiteralPath $Path).Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        actions = $actions
        completionEvidence = $completion
        restartManagerEvidence = $restartManager
        errors = $errors
    }
}

function Get-WindowsInstallerEvents {
    param(
        [Parameter(Mandatory = $true)][DateTime]$StartTime,
        [Parameter(Mandatory = $true)][DateTime]$EndTime
    )

    $msiEvents = @()
    $restartEvents = @()
    try {
        $events = @(Get-WinEvent -FilterHashtable @{
            LogName = "Application"
            StartTime = $StartTime
            EndTime = $EndTime
        } -ErrorAction Stop | Where-Object {
            $_.ProviderName -in @("MsiInstaller", "Microsoft-Windows-MsiInstaller", "Microsoft-Windows-RestartManager")
        } | Select-Object -First 1000)
        foreach ($event in $events) {
            $record = [ordered]@{
                timeCreatedUtc = if ($null -eq $event.TimeCreated) { $null } else { ([DateTimeOffset]$event.TimeCreated).ToUniversalTime().ToString("o") }
                providerName = $event.ProviderName
                id = $event.Id
                level = $event.LevelDisplayName
                message = ConvertTo-RedactedText -Text $event.Message
            }
            if ($event.ProviderName -match 'RestartManager') {
                $restartEvents += $record
            }
            else {
                $msiEvents += $record
            }
        }
    }
    catch {
        $msiEvents += [ordered]@{ queryError = $_.Exception.Message }
    }

    try {
        $restartLog = Get-WinEvent -ListLog "Microsoft-Windows-RestartManager/Operational" -ErrorAction Stop
        if ($restartLog.IsEnabled) {
            foreach ($event in @(Get-WinEvent -FilterHashtable @{
                LogName = "Microsoft-Windows-RestartManager/Operational"
                StartTime = $StartTime
                EndTime = $EndTime
            } -ErrorAction Stop | Select-Object -First 1000)) {
                $restartEvents += [ordered]@{
                    timeCreatedUtc = if ($null -eq $event.TimeCreated) { $null } else { ([DateTimeOffset]$event.TimeCreated).ToUniversalTime().ToString("o") }
                    providerName = $event.ProviderName
                    id = $event.Id
                    level = $event.LevelDisplayName
                    message = ConvertTo-RedactedText -Text $event.Message
                }
            }
        }
    }
    catch {
        $restartEvents += [ordered]@{ queryError = $_.Exception.Message }
    }

    return [ordered]@{
        msiInstaller = $msiEvents
        restartManager = $restartEvents
    }
}

function Get-MigrationInfo {
    param(
        [AllowNull()][string]$FromVersion,
        [AllowNull()][string]$ToVersion
    )

    $legacyBridge = $false
    if ($FromVersion -eq "0.0.172" -and $ToVersion) {
        try {
            $legacyBridge = ([Version]$ToVersion) -ge ([Version]"0.0.173")
        }
        catch {
            $legacyBridge = $false
        }
    }
    return [ordered]@{
        fromVersion = $FromVersion
        toVersion = $ToVersion
        kind = if ($legacyBridge) { "legacy-expanded-msi-bridge" } elseif ($FromVersion -and $ToVersion) { "archive-to-archive" } else { "unknown" }
        legacyBridge = $legacyBridge
        note = if ($legacyBridge) {
            "v0.0.172 still owns roughly 24,000 expanded sidecar components; this one-time bridge measures their removal, not steady-state archive upgrades."
        }
        else {
            "Archive-to-archive upgrades are the representative steady-state path after v0.0.173."
        }
    }
}

function Get-DurationMilliseconds {
    param(
        [AllowNull()][string]$Start,
        [AllowNull()][string]$End
    )

    if (-not $Start -or -not $End) {
        return $null
    }
    return [math]::Round((([DateTimeOffset]$End) - ([DateTimeOffset]$Start)).TotalMilliseconds, 3)
}

function Resolve-CovenExecutable {
    param($InstalledRecord)

    if ($LaunchPath) {
        return (Resolve-Path -LiteralPath $LaunchPath).Path
    }
    if ($null -ne $InstalledRecord -and $InstalledRecord.installLocation) {
        foreach ($name in @("app.exe", "CovenCave.exe")) {
            $candidate = Join-Path $InstalledRecord.installLocation $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }
    if ($null -ne $InstalledRecord -and $InstalledRecord.displayIcon) {
        $iconPath = ($InstalledRecord.displayIcon -replace '^"|"$' -replace ',\d+$', '').Trim('"')
        if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
            return (Resolve-Path -LiteralPath $iconPath).Path
        }
    }
    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles "CovenCave\app.exe"),
        (Join-Path $env:ProgramFiles "CovenCave\CovenCave.exe"),
        (Join-Path $env:LOCALAPPDATA "CovenCave\app.exe"),
        (Join-Path $env:LOCALAPPDATA "CovenCave\CovenCave.exe")
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Could not resolve the installed CovenCave executable; pass -LaunchPath"
}

function Wait-ForCovenReadiness {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $runningRoots = @(Get-ApplicationRootIds -Processes (Get-AllProcesses) -Executable $Executable)
    if ($runningRoots.Count -eq 0) {
        Start-Process -FilePath $Executable | Out-Null
    }

    $started = [DateTimeOffset]::UtcNow
    $sidecarReady = $null
    $interactiveReady = $null
    $deadline = $started.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and ($null -eq $sidecarReady -or $null -eq $interactiveReady)) {
        $all = Get-AllProcesses
        $appIds = @(Get-ApplicationRootIds -Processes $all -Executable $Executable)
        if ($appIds.Count -gt 0) {
            $descendants = Get-DescendantIds -Processes $all -RootIds $appIds
            $nodeIds = @($all | Where-Object {
                $_.Name -ieq "node.exe" -and $descendants -contains [int]$_.ProcessId
            } | ForEach-Object { [int]$_.ProcessId })
            if ($null -eq $sidecarReady -and $nodeIds.Count -gt 0) {
                try {
                    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {
                        $nodeIds -contains [int]$_.OwningProcess
                    })
                    if ($listeners.Count -gt 0) {
                        $sidecarReady = [DateTimeOffset]::UtcNow.ToString("o")
                    }
                }
                catch {
                    # Keep polling; the final summary still records a timeout.
                }
            }
            if ($null -eq $interactiveReady) {
                foreach ($process in @(Get-Process -Id $appIds -ErrorAction SilentlyContinue)) {
                    if ($process.Responding -and $process.MainWindowHandle -ne 0) {
                        $interactiveReady = [DateTimeOffset]::UtcNow.ToString("o")
                        break
                    }
                }
            }
        }
        if ($null -eq $sidecarReady -or $null -eq $interactiveReady) {
            Start-Sleep -Milliseconds 250
        }
    }
    return [ordered]@{
        monitoringStartedAtUtc = $started.ToString("o")
        sidecarReadyAtUtc = $sidecarReady
        interactiveReadyAtUtc = $interactiveReady
        timedOut = $null -eq $sidecarReady -or $null -eq $interactiveReady
    }
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$summaryPath = Join-Path $resolvedOutput "summary.json"

if ($PSCmdlet.ParameterSetName -eq "Fixture") {
    $resolvedFixture = (Resolve-Path -LiteralPath $FixturePath).Path
    $fixture = Get-Content -Raw -LiteralPath $resolvedFixture | ConvertFrom-Json
    $fixtureRoot = Split-Path -Parent $resolvedFixture
    $fixtureLog = if ([System.IO.Path]::IsPathRooted($fixture.msiLogPath)) {
        $fixture.msiLogPath
    }
    else {
        Join-Path $fixtureRoot $fixture.msiLogPath
    }
    $retainedLog = Join-Path $resolvedOutput "msi-verbose.log"
    Copy-Item -LiteralPath $fixtureLog -Destination $retainedLog -Force
    $logEvidence = Get-MsiLogEvidence -Path $retainedLog
    $fixtureProcessSelection = Get-OptionalProperty -Value $fixture -Name "processSelection"
    $summary = [ordered]@{
        schemaVersion = 1
        mode = "fixture"
        generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
        candidate = $fixture.candidate
        installedBefore = $fixture.installedBefore
        installedAfter = $fixture.installedAfter
        migration = Get-MigrationInfo -FromVersion $fixture.installedBefore.version -ToVersion $fixture.candidate.productVersion
        installer = $fixture.installer
        timeline = [ordered]@{
            startedAtUtc = $fixture.timeline.startedAtUtc
            installerStartedAtUtc = $fixture.timeline.installerStartedAtUtc
            installerEndedAtUtc = $fixture.timeline.installerEndedAtUtc
            sidecarReadyAtUtc = $fixture.timeline.sidecarReadyAtUtc
            interactiveReadyAtUtc = $fixture.timeline.interactiveReadyAtUtc
            installerDurationMilliseconds = Get-DurationMilliseconds -Start $fixture.timeline.installerStartedAtUtc -End $fixture.timeline.installerEndedAtUtc
            sidecarReadyAfterInstallerMilliseconds = Get-DurationMilliseconds -Start $fixture.timeline.installerEndedAtUtc -End $fixture.timeline.sidecarReadyAtUtc
            interactiveReadyAfterInstallerMilliseconds = Get-DurationMilliseconds -Start $fixture.timeline.installerEndedAtUtc -End $fixture.timeline.interactiveReadyAtUtc
        }
        processSnapshots = $fixture.processSnapshots
        processSelection = if ($null -eq $fixtureProcessSelection) {
            $null
        }
        else {
            [ordered]@{
                executable = $fixtureProcessSelection.executable
                selectedRootProcessIds = Get-ApplicationRootIds `
                    -Processes $fixtureProcessSelection.processes `
                    -Executable $fixtureProcessSelection.executable
            }
        }
        performanceSamples = $fixture.performanceSamples
        events = $fixture.events
        msiLog = $logEvidence
        acceptance = Get-UpgradeAcceptance `
            -BeforeProcesses $fixture.processSnapshots.before `
            -AfterInstallerProcesses $fixture.processSnapshots.afterInstaller `
            -Events $fixture.events `
            -MsiLog $logEvidence `
            -InstallerExitCode $fixture.installer.exitCode
        safety = [ordered]@{
            userDataDeletionInvoked = $false
            userDataPathsModifiedDirectly = $false
            uninstallInvoked = $false
            forcedInstallerTermination = $false
            rebootSuppressed = $true
        }
    }
    Write-JsonAtomic -Value $summary -Path $summaryPath
    Write-Host "Windows upgrade diagnostics fixture: $summaryPath"
    return
}

$candidateSource = if ($PSCmdlet.ParameterSetName -eq "Url") { $CandidateUrl } else { $CandidateMsiPath }
if ($PSCmdlet.ParameterSetName -eq "Url") {
    $uri = [Uri]$CandidateUrl
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https") {
        throw "CandidateUrl must be an absolute HTTPS URL"
    }
    # Signed download URLs can carry credentials in their query string. Keep
    # only the stable path in diagnostics.
    $candidateSource = $uri.GetLeftPart([UriPartial]::Path)
    $downloadPath = Join-Path $resolvedOutput "candidate.msi"
    Invoke-WebRequest -Uri $uri -OutFile $downloadPath -UseBasicParsing
    $resolvedCandidate = $downloadPath
}
else {
    $resolvedCandidate = (Resolve-Path -LiteralPath $CandidateMsiPath).Path
}

$candidate = Get-MsiMetadata -Path $resolvedCandidate
$candidate.source = $candidateSource
$installedBefore = Get-InstalledCovenCaveRecord
$fromVersion = if ($null -eq $installedBefore) { $null } else { $installedBefore.version }

if ($ExpectedFromVersion -and $fromVersion -ne $ExpectedFromVersion) {
    throw "Installed version '$fromVersion' does not match -ExpectedFromVersion '$ExpectedFromVersion'"
}
if ($ExpectedToVersion -and $candidate.productVersion -ne $ExpectedToVersion) {
    throw "Candidate version '$($candidate.productVersion)' does not match -ExpectedToVersion '$ExpectedToVersion'"
}
$installedExecutable = if ($null -eq $installedBefore) {
    $null
}
else {
    Resolve-CovenExecutable -InstalledRecord $installedBefore
}

if (-not $AllowInstall) {
    $summary = [ordered]@{
        schemaVersion = 1
        mode = "preflight"
        generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
        candidate = $candidate
        installedBefore = $installedBefore
        installedAfter = $installedBefore
        migration = Get-MigrationInfo -FromVersion $fromVersion -ToVersion $candidate.productVersion
        installer = [ordered]@{ status = "not-started"; reason = "-AllowInstall was not supplied" }
        timeline = $null
        processSnapshots = [ordered]@{
            before = if ($installedExecutable) {
                Get-CovenProcessSnapshot -Executable $installedExecutable
            }
            else {
                @()
            }
        }
        performanceSamples = @()
        events = [ordered]@{ msiInstaller = @(); restartManager = @() }
        msiLog = [ordered]@{ exists = $false; status = "not-started" }
        safety = [ordered]@{
            userDataDeletionInvoked = $false
            userDataPathsModifiedDirectly = $false
            uninstallInvoked = $false
            forcedInstallerTermination = $false
            rebootSuppressed = $true
        }
    }
    Write-JsonAtomic -Value $summary -Path $summaryPath
    Write-Host "Preflight only; pass -AllowInstall with both expected versions to run the upgrade: $summaryPath"
    return
}

if (-not $ExpectedFromVersion -or -not $ExpectedToVersion) {
    throw "Live installation requires -ExpectedFromVersion and -ExpectedToVersion"
}
if ($null -eq $installedBefore) {
    throw "CovenCave is not registered as installed; this harness measures upgrades, not clean installs"
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run an elevated PowerShell for a repeatable MSI upgrade benchmark"
}

$captureStarted = [DateTimeOffset]::UtcNow
$installerStarted = $null
$installerEnded = $null
$installerExitCode = $null
$timedOut = $false
$failure = $null
$samples = @()
$beforeProcesses = @(Get-CovenProcessSnapshot -Executable $installedExecutable)
$afterInstallerProcesses = @()
$afterReadyProcesses = @()
$readiness = [ordered]@{
    monitoringStartedAtUtc = $null
    sidecarReadyAtUtc = $null
    interactiveReadyAtUtc = $null
    timedOut = $false
    skipped = [bool]$SkipReadiness
}
$verboseLogPath = Join-Path $resolvedOutput "msi-verbose.log"
$installerProcess = $null

try {
    $preexistingInstallers = @(Get-AllProcesses | Where-Object { $_.Name -ieq "msiexec.exe" })
    if ($preexistingInstallers.Count -gt 0) {
        $ids = ($preexistingInstallers | ForEach-Object { [string]$_.ProcessId }) -join ", "
        throw "Refusing to mix this benchmark with existing Windows Installer activity (msiexec PIDs: $ids)"
    }
    $installerArguments = @(
        "/i",
        "`"$resolvedCandidate`"",
        "/passive",
        "/norestart",
        "REBOOT=ReallySuppress",
        "/L*V",
        "`"$verboseLogPath`""
    )
    $installerStarted = [DateTimeOffset]::UtcNow
    $installerProcess = Start-Process -FilePath (Join-Path $env:SystemRoot "System32\msiexec.exe") `
        -ArgumentList $installerArguments -PassThru
    $deadline = $installerStarted.AddMinutes($TimeoutMinutes)
    while (-not $installerProcess.HasExited) {
        $samples += Get-InstallerPerformanceSample `
            -ClientProcessId $installerProcess.Id `
            -TransactionStartedAt $installerStarted
        if ([DateTimeOffset]::UtcNow -ge $deadline) {
            $timedOut = $true
            $failure = "MSI exceeded the $TimeoutMinutes minute diagnostic timeout; it was not forcibly terminated so Windows Installer can complete or roll back safely"
            break
        }
        Start-Sleep -Seconds $SampleIntervalSeconds
        $installerProcess.Refresh()
    }
    if (-not $timedOut) {
        $installerProcess.WaitForExit()
        $installerEnded = [DateTimeOffset]::UtcNow
        $installerExitCode = $installerProcess.ExitCode
        $samples += Get-InstallerPerformanceSample `
            -ClientProcessId $installerProcess.Id `
            -TransactionStartedAt $installerStarted
        if ($installerExitCode -ne 0) {
            $failure = "msiexec returned $installerExitCode"
        }
    }
    $trackedBeforeIds = @($beforeProcesses | ForEach-Object { [int]$_.processId })
    $afterInstallerProcesses = @(Get-CovenProcessSnapshot `
        -Executable $installedExecutable `
        -TrackedProcessIds $trackedBeforeIds)

    if (-not $timedOut -and $installerExitCode -eq 0 -and -not $SkipReadiness) {
        $installedAfterForLaunch = Get-InstalledCovenCaveRecord
        $executable = Resolve-CovenExecutable -InstalledRecord $installedAfterForLaunch
        $readiness = Wait-ForCovenReadiness -Executable $executable -TimeoutSeconds $ReadyTimeoutSeconds
        $readiness.skipped = $false
        $afterReadyProcesses = @(Get-CovenProcessSnapshot `
            -Executable $executable `
            -TrackedProcessIds $trackedBeforeIds)
        if ($readiness.timedOut -and -not $failure) {
            $failure = "CovenCave did not reach both sidecar and interactive readiness within $ReadyTimeoutSeconds seconds"
        }
    }
}
catch {
    $failure = $_.Exception.Message
}

$captureEnded = [DateTimeOffset]::UtcNow
$installedAfter = Get-InstalledCovenCaveRecord
$events = Get-WindowsInstallerEvents -StartTime $captureStarted.LocalDateTime -EndTime $captureEnded.LocalDateTime
$logEvidence = Get-MsiLogEvidence -Path $verboseLogPath
if (-not $timedOut -and $installerExitCode -eq 0 -and -not $logEvidence.exists -and -not $failure) {
    $failure = "msiexec returned success but /L*V did not create $verboseLogPath"
}
$acceptance = Get-UpgradeAcceptance `
    -BeforeProcesses $beforeProcesses `
    -AfterInstallerProcesses $afterInstallerProcesses `
    -Events $events `
    -MsiLog $logEvidence `
    -InstallerExitCode $installerExitCode
if (-not $failure -and -not $acceptance.noOrphanedSidecar) {
    $failure = "The upgrade left packaged sidecar process IDs running: $($acceptance.orphanedSidecarProcessIds -join ', ')"
}
if (-not $failure -and -not $acceptance.noRebootWarning) {
    $failure = "The upgrade emitted reboot-required evidence"
}
$unattributedInstallers = @($samples | ForEach-Object { @($_.unattributedProcesses) } | Where-Object { $null -ne $_ })
if (-not $failure -and $unattributedInstallers.Count -gt 0) {
    $failure = "Unrelated Windows Installer activity started during the benchmark; CPU/I/O attribution is not isolated"
}

$summary = [ordered]@{
    schemaVersion = 1
    mode = "install"
    generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    candidate = $candidate
    installedBefore = $installedBefore
    installedAfter = $installedAfter
    migration = Get-MigrationInfo -FromVersion $fromVersion -ToVersion $candidate.productVersion
    installer = [ordered]@{
        processId = if ($null -eq $installerProcess) { $null } else { $installerProcess.Id }
        exitCode = $installerExitCode
        timedOut = $timedOut
        timeoutMinutes = $TimeoutMinutes
        failure = $failure
        arguments = @("/i", "[candidate MSI]", "/passive", "/norestart", "REBOOT=ReallySuppress", "/L*V", "[diagnostic log]")
    }
    timeline = [ordered]@{
        startedAtUtc = $captureStarted.ToString("o")
        installerStartedAtUtc = if ($null -eq $installerStarted) { $null } else { $installerStarted.ToString("o") }
        installerEndedAtUtc = if ($null -eq $installerEnded) { $null } else { $installerEnded.ToString("o") }
        sidecarReadyAtUtc = $readiness.sidecarReadyAtUtc
        interactiveReadyAtUtc = $readiness.interactiveReadyAtUtc
        installerDurationMilliseconds = Get-DurationMilliseconds `
            -Start $(if ($null -eq $installerStarted) { $null } else { $installerStarted.ToString("o") }) `
            -End $(if ($null -eq $installerEnded) { $null } else { $installerEnded.ToString("o") })
        sidecarReadyAfterInstallerMilliseconds = Get-DurationMilliseconds `
            -Start $(if ($null -eq $installerEnded) { $null } else { $installerEnded.ToString("o") }) `
            -End $readiness.sidecarReadyAtUtc
        interactiveReadyAfterInstallerMilliseconds = Get-DurationMilliseconds `
            -Start $(if ($null -eq $installerEnded) { $null } else { $installerEnded.ToString("o") }) `
            -End $readiness.interactiveReadyAtUtc
        captureEndedAtUtc = $captureEnded.ToString("o")
    }
    processSnapshots = [ordered]@{
        before = $beforeProcesses
        afterInstaller = $afterInstallerProcesses
        afterReadiness = $afterReadyProcesses
    }
    performanceSamples = $samples
    events = $events
    msiLog = $logEvidence
    readiness = $readiness
    acceptance = $acceptance
    safety = [ordered]@{
        userDataDeletionInvoked = $false
        userDataPathsModifiedDirectly = $false
        uninstallInvoked = $false
        forcedInstallerTermination = $false
        rebootSuppressed = $true
    }
}
Write-JsonAtomic -Value $summary -Path $summaryPath
Write-Host "Windows upgrade diagnostics: $summaryPath"

if ($failure) {
    throw "$failure (diagnostics retained at $summaryPath)"
}
