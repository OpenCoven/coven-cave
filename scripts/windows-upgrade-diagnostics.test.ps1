$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message (expected '$Expected', got '$Actual')"
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("coven-upgrade-diagnostics-test-" + [Guid]::NewGuid().ToString("N"))
$fixtureRoot = Join-Path $testRoot "fixture"
$outputRoot = Join-Path $testRoot "output"
[System.IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null

try {
    $harnessSource = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "windows-upgrade-diagnostics.ps1")
    Assert-True ($harnessSource -match 'CovenCave\\app\.exe') "readiness must resolve the installed app.exe binary"
    Assert-True ($harnessSource -match '@\("app\.exe", "CovenCave\.exe"\)') "process snapshots must track the installed app.exe process"
    Assert-True ($harnessSource -match '\[AllowEmptyCollection\(\)\]\[object\[\]\]\$AfterInstallerProcesses') "acceptance must allow a clean empty post-installer process snapshot"
    Assert-True ($harnessSource -match '\$beforeProcesses = @\(Get-CovenProcessSnapshot') "live pre-installer snapshots must preserve empty arrays instead of binding null"
    Assert-True ($harnessSource -match '\$afterInstallerProcesses = @\(Get-CovenProcessSnapshot') "live post-installer snapshots must preserve empty arrays instead of binding null"
    Assert-True ($harnessSource -match '\$Value -is \[System\.Collections\.IDictionary\]') "live ordered event records must expose dictionary keys to reboot detection"

    $parseErrors = $null
    $tokens = $null
    $harnessAst = [System.Management.Automation.Language.Parser]::ParseInput(
        $harnessSource,
        [ref]$tokens,
        [ref]$parseErrors
    )
    Assert-Equal $parseErrors.Count 0 "diagnostic harness must parse before production functions are exercised"
    $productionFunctions = @($harnessAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in @("Get-OptionalProperty", "Get-UpgradeAcceptance")
    }, $true))
    Assert-Equal $productionFunctions.Count 2 "acceptance regression must execute both production functions"
    foreach ($function in $productionFunctions) {
        Invoke-Expression $function.Extent.Text
    }
    $orderedDictionaryAcceptance = Get-UpgradeAcceptance `
        -BeforeProcesses @() `
        -AfterInstallerProcesses @() `
        -Events ([ordered]@{
            restartManager = @([ordered]@{ id = 10005; message = "A machine restart is necessary" })
        }) `
        -MsiLog ([ordered]@{ restartManagerEvidence = @() }) `
        -InstallerExitCode 0
    Assert-True (-not $orderedDictionaryAcceptance.noRebootWarning) "production acceptance must detect an OrderedDictionary Restart Manager warning"
    Assert-Equal $orderedDictionaryAcceptance.rebootWarningEvidence.Count 1 "OrderedDictionary warning evidence must be retained exactly once"

    $log = @'
=== Verbose logging started ===
MSI (s) (10:20) [14:00:00:001]: Action start 14:00:00: InstallValidate.
MSI (s) (10:20) [14:00:01:001]: RESTART MANAGER: Session opened.
MSI (s) (10:20) [14:00:02:001]: Action ended 14:00:02: InstallValidate. Return value 1.
MSI (s) (10:20) [14:00:03:001]: Action start 14:00:03: InstallFinalize.
MSI (s) (10:20) [14:00:10:001]: Action ended 14:00:10: InstallFinalize. Return value 1.
MSI (s) (10:20) [14:00:10:100]: Product: CovenCave -- Installation operation completed successfully.
MSI (s) (10:20) [14:00:10:200]: MainEngineThread is returning 0
'@
    [System.IO.File]::WriteAllText((Join-Path $fixtureRoot "bridge-msi.log"), $log)

    $fixture = [ordered]@{
        schemaVersion = 1
        candidate = [ordered]@{
            source = "fixture://candidate.msi"
            path = "C:\fixture\CovenCave_0.0.173_x64_en-US.msi"
            sha256 = "0000000000000000000000000000000000000000000000000000000000000000"
            bytes = 181293056
            productName = "CovenCave"
            productVersion = "0.0.173"
            productCode = "{11111111-1111-1111-1111-111111111111}"
            upgradeCode = "{22222222-2222-2222-2222-222222222222}"
        }
        installedBefore = [ordered]@{ displayName = "CovenCave"; version = "0.0.172" }
        installedAfter = [ordered]@{ displayName = "CovenCave"; version = "0.0.173" }
        installer = [ordered]@{ processId = 4100; exitCode = 0; timedOut = $false }
        timeline = [ordered]@{
            startedAtUtc = "2026-07-10T18:00:00.0000000+00:00"
            installerStartedAtUtc = "2026-07-10T18:00:01.0000000+00:00"
            installerEndedAtUtc = "2026-07-10T18:02:01.0000000+00:00"
            sidecarReadyAtUtc = "2026-07-10T18:02:31.0000000+00:00"
            interactiveReadyAtUtc = "2026-07-10T18:02:36.0000000+00:00"
        }
        processSnapshots = [ordered]@{
            before = @([ordered]@{ processId = 100; name = "CovenCave.exe" })
            afterInstaller = @()
            afterReadiness = @([ordered]@{ processId = 200; name = "CovenCave.exe" })
        }
        processSelection = [ordered]@{
            executable = "C:\Program Files\CovenCave\app.exe"
            processes = @(
                [ordered]@{ ProcessId = 410; ExecutablePath = "C:\Program Files\CovenCave\app.exe" },
                [ordered]@{ ProcessId = 411; ExecutablePath = "C:\OtherProduct\app.exe" },
                [ordered]@{ ProcessId = 412; ExecutablePath = "C:\Program Files\CovenCave\CovenCave.exe" }
            )
        }
        performanceSamples = @(
            [ordered]@{ capturedAtUtc = "2026-07-10T18:00:01Z"; clientProcessId = 4100; processIds = @(4100); processes = @([ordered]@{ processId = 4100; relationship = "launched-client" }); cpuMilliseconds = 100; readBytes = 1024; writeBytes = 2048 },
            [ordered]@{ capturedAtUtc = "2026-07-10T18:02:01Z"; clientProcessId = 4100; processIds = @(4100, 4200); processes = @([ordered]@{ processId = 4100; relationship = "launched-client" }, [ordered]@{ processId = 4200; relationship = "transaction-service" }); cpuMilliseconds = 1000; readBytes = 4096; writeBytes = 8192 }
        )
        events = [ordered]@{
            msiInstaller = @([ordered]@{ id = 11707; providerName = "MsiInstaller" })
            restartManager = @([ordered]@{ id = 10000; providerName = "Microsoft-Windows-RestartManager" })
        }
        msiLogPath = "bridge-msi.log"
    }
    $fixturePath = Join-Path $fixtureRoot "fixture.json"
    [System.IO.File]::WriteAllText($fixturePath, ($fixture | ConvertTo-Json -Depth 10))

    & (Join-Path $PSScriptRoot "windows-upgrade-diagnostics.ps1") `
        -FixturePath $fixturePath `
        -OutputDirectory $outputRoot

    $summaryPath = Join-Path $outputRoot "summary.json"
    Assert-True (Test-Path -LiteralPath $summaryPath -PathType Leaf) "fixture run must write summary.json"
    $summary = Get-Content -Raw -LiteralPath $summaryPath | ConvertFrom-Json

    Assert-Equal $summary.schemaVersion 1 "summary schema must be versioned"
    Assert-Equal $summary.mode "fixture" "fixture mode must be explicit"
    Assert-Equal $summary.migration.kind "legacy-expanded-msi-bridge" "0.0.172 to 0.0.173 must not be reported as steady state"
    Assert-True $summary.migration.legacyBridge "legacy bridge flag must be true"
    Assert-Equal $summary.timeline.installerDurationMilliseconds 120000 "installer duration must be derived from timestamps"
    Assert-Equal $summary.timeline.sidecarReadyAfterInstallerMilliseconds 30000 "sidecar readiness must be separate from MSI duration"
    Assert-Equal $summary.timeline.interactiveReadyAfterInstallerMilliseconds 35000 "interactive readiness must be separate from sidecar readiness"
    Assert-True $summary.msiLog.exists "/L*V fixture log must be retained and verified"
    Assert-Equal $summary.msiLog.actions.Count 4 "MSI action evidence must retain starts and endings"
    Assert-Equal $summary.msiLog.actions[0].action "InstallValidate" "MSI action parser must preserve action names"
    Assert-True ($summary.msiLog.completionEvidence.Count -ge 1) "successful completion evidence must be parsed"
    Assert-True ($summary.msiLog.restartManagerEvidence.Count -ge 1) "Restart Manager log evidence must be parsed"
    Assert-Equal $summary.events.msiInstaller.Count 1 "MSI event evidence must be retained"
    Assert-Equal $summary.events.restartManager.Count 1 "Restart Manager events must be retained"
    Assert-True $summary.acceptance.noOrphanedSidecar "fixture must prove no packaged sidecar was orphaned"
    Assert-True $summary.acceptance.noRebootWarning "fixture must prove no reboot warning remained"
    Assert-Equal $summary.performanceSamples.Count 2 "CPU and I/O samples must be retained"
    $selectedFixtureRoots = @($summary.processSelection.selectedRootProcessIds)
    Assert-Equal $selectedFixtureRoots.Count 1 "only the resolved installed executable may seed the process tree"
    Assert-Equal $selectedFixtureRoots[0] 410 "an unrelated app.exe must not satisfy readiness"
    Assert-Equal $summary.performanceSamples[1].processes[1].relationship "transaction-service" "installer client/service attribution must be retained"
    Assert-True (-not $summary.safety.userDataDeletionInvoked) "harness must never delete user data"
    Assert-True (-not $summary.safety.userDataPathsModifiedDirectly) "harness must not modify user-data paths directly"
    Assert-True (-not $summary.safety.forcedInstallerTermination) "timeout policy must never force-kill Windows Installer"
    Assert-True $summary.safety.rebootSuppressed "benchmark installs must suppress restarts"

    $negativeOutput = Join-Path $testRoot "negative-output"
    $fixture.installer.exitCode = 3010
    $fixture.processSnapshots.before = @([ordered]@{ processId = 501; name = "node.exe" })
    $fixture.processSnapshots.afterInstaller = @([ordered]@{ processId = 501; name = "node.exe" })
    $fixture.events.restartManager = @([ordered]@{
        id = 10005
        providerName = "Microsoft-Windows-RestartManager"
        message = "A machine restart is necessary"
    })
    [System.IO.File]::WriteAllText($fixturePath, ($fixture | ConvertTo-Json -Depth 10))
    & (Join-Path $PSScriptRoot "windows-upgrade-diagnostics.ps1") `
        -FixturePath $fixturePath `
        -OutputDirectory $negativeOutput
    $negative = Get-Content -Raw -LiteralPath (Join-Path $negativeOutput "summary.json") | ConvertFrom-Json
    Assert-True (-not $negative.acceptance.noOrphanedSidecar) "retained sidecar PID must fail orphan acceptance"
    Assert-Equal $negative.acceptance.orphanedSidecarProcessIds[0] 501 "orphan evidence must retain the PID"
    Assert-True (-not $negative.acceptance.noRebootWarning) "3010/RM evidence must fail reboot acceptance"
    Assert-True ($negative.acceptance.rebootWarningEvidence.Count -ge 2) "exit code and Restart Manager warning must both be retained"

    Write-Host "windows-upgrade-diagnostics fixture test passed"
}
finally {
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTest = [System.IO.Path]::GetFullPath($testRoot)
    if ($resolvedTest.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTest -Recurse -Force -ErrorAction SilentlyContinue
    }
}
