[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,

    [string]$OutputPath = "windows-msi-metrics.json"
)

$ErrorActionPreference = "Stop"
$rowBudget = 64
$byteBudget = 256MB
$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$installer = $null
$database = $null

function Open-MsiView {
    param([Parameter(Mandatory = $true)][string]$Query)

    $view = $database.GetType().InvokeMember(
        "OpenView",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null,
        $database,
        @($Query)
    )
    $view.GetType().InvokeMember(
        "Execute",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null,
        $view,
        $null
    ) | Out-Null
    return $view
}

function Read-MsiRows {
    param(
        [Parameter(Mandatory = $true)][string]$Query,
        [Parameter(Mandatory = $true)][scriptblock]$OnRow
    )

    $view = Open-MsiView -Query $Query
    $count = 0
    try {
        while ($count -le $rowBudget) {
            $record = $view.GetType().InvokeMember(
                "Fetch",
                [System.Reflection.BindingFlags]::InvokeMethod,
                $null,
                $view,
                $null
            )
            if ($null -eq $record) {
                break
            }
            $count += 1
            if ($count -le $rowBudget) {
                & $OnRow $record
            }
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
        }
    }
    finally {
        $view.GetType().InvokeMember(
            "Close",
            [System.Reflection.BindingFlags]::InvokeMethod,
            $null,
            $view,
            $null
        ) | Out-Null
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    }
    return $count
}

try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.GetType().InvokeMember(
        "OpenDatabase",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null,
        $installer,
        @($resolvedMsi, 0)
    )

    [long]$installedFileBytes = 0
    [int]$serverArchiveRows = 0
    $fileRows = Read-MsiRows -Query 'SELECT `FileSize`, `FileName` FROM `File`' -OnRow {
        param($record)
        $size = $record.GetType().InvokeMember(
            "IntegerData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(1)
        )
        $name = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(2)
        )
        $script:installedFileBytes += [long]$size
        $longName = ($name -split '\|')[-1]
        if ($longName -eq "server.tar.gz") {
            $script:serverArchiveRows += 1
        }
    }
    $componentRows = Read-MsiRows -Query 'SELECT `Component` FROM `Component`' -OnRow { param($record) }
    $createFolderRows = Read-MsiRows -Query 'SELECT `Directory_` FROM `CreateFolder`' -OnRow { param($record) }
    $directoryRows = Read-MsiRows -Query 'SELECT `Directory` FROM `Directory`' -OnRow { param($record) }

    $metrics = [ordered]@{
        schemaVersion = 1
        msiPath = $resolvedMsi
        msiBytes = (Get-Item -LiteralPath $resolvedMsi).Length
        installedFileBytes = $installedFileBytes
        fileRows = $fileRows
        componentRows = $componentRows
        createFolderRows = $createFolderRows
        directoryRows = $directoryRows
        serverArchiveRows = $serverArchiveRows
        rowBudget = $rowBudget
        byteBudget = $byteBudget
    }
    $json = $metrics | ConvertTo-Json
    [System.IO.File]::WriteAllText($resolvedOutput, "$json`n")
    $metrics | Format-List | Out-String | Write-Host
    Write-Host "MSI metrics JSON: $resolvedOutput"

    $violations = @()
    foreach ($metric in @("fileRows", "componentRows", "createFolderRows", "directoryRows")) {
        if ($metrics[$metric] -gt $rowBudget) {
            $violations += "$metric exceeds $rowBudget"
        }
    }
    foreach ($metric in @("msiBytes", "installedFileBytes")) {
        if ($metrics[$metric] -gt $byteBudget) {
            $violations += "$metric exceeds $byteBudget bytes"
        }
    }
    if ($serverArchiveRows -ne 1) {
        $violations += "expected exactly one server.tar.gz File row; found $serverArchiveRows"
    }
    if ($violations.Count -gt 0) {
        throw "Windows MSI budget failed: $($violations -join '; ')"
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
