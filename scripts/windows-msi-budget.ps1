[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,

    [string]$OutputPath = "windows-msi-metrics.json"
)

$ErrorActionPreference = "Stop"
# Keep exact, independently reviewed baselines per table. Sharing the largest
# value would leave silent slack in smaller tables and hide package growth.
$rowBudgets = [ordered]@{
    fileRows = 382
    componentRows = 387
    createFolderRows = 382
    directoryRows = 50
}
$rowInspectionLimit = 4096
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
        while ($true) {
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
            try {
                if ($count -gt $rowInspectionLimit) {
                    throw "MSI table row inspection exceeded the independent limit of $rowInspectionLimit"
                }
                & $OnRow $record
            }
            finally {
                [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
            }
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
    $fileEntries = [System.Collections.Generic.List[object]]::new()
    $fileRows = Read-MsiRows -Query 'SELECT `File`, `Component_`, `FileName`, `FileSize` FROM `File`' -OnRow {
        param($record)
        $identifier = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(1)
        )
        $component = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(2)
        )
        $name = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(3)
        )
        $size = $record.GetType().InvokeMember(
            "IntegerData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(4)
        )
        $script:installedFileBytes += [long]$size
        $longName = ($name -split '\|')[-1]
        [void]$script:fileEntries.Add([ordered]@{
            id = $identifier
            component = $component
            name = $longName
            size = [long]$size
        })
        if ($longName -eq "server.tar.zst") {
            $script:serverArchiveRows += 1
        }
    }
    $componentEntries = [System.Collections.Generic.List[object]]::new()
    $componentRows = Read-MsiRows -Query 'SELECT `Component`, `Directory_` FROM `Component`' -OnRow {
        param($record)
        $identifier = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(1)
        )
        $directory = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(2)
        )
        [void]$script:componentEntries.Add([ordered]@{
            id = $identifier
            directory = $directory
        })
    }
    $createFolderEntries = [System.Collections.Generic.List[object]]::new()
    $createFolderRows = Read-MsiRows -Query 'SELECT `Directory_`, `Component_` FROM `CreateFolder`' -OnRow {
        param($record)
        $directory = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(1)
        )
        $component = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(2)
        )
        [void]$script:createFolderEntries.Add([ordered]@{
            directory = $directory
            component = $component
        })
    }
    $directoryEntries = [System.Collections.Generic.List[object]]::new()
    $directoryRows = Read-MsiRows -Query 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`' -OnRow {
        param($record)
        $identifier = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(1)
        )
        $parent = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(2)
        )
        $name = $record.GetType().InvokeMember(
            "StringData",
            [System.Reflection.BindingFlags]::GetProperty,
            $null,
            $record,
            @(3)
        )
        [void]$script:directoryEntries.Add([ordered]@{
            id = $identifier
            parent = $parent
            name = $name
        })
    }

    $metrics = [ordered]@{
        schemaVersion = 2
        msiPath = $resolvedMsi
        msiBytes = (Get-Item -LiteralPath $resolvedMsi).Length
        installedFileBytes = $installedFileBytes
        fileRows = $fileRows
        fileEntries = @($fileEntries)
        componentRows = $componentRows
        componentEntries = @($componentEntries)
        createFolderRows = $createFolderRows
        createFolderEntries = @($createFolderEntries)
        directoryRows = $directoryRows
        directoryEntries = @($directoryEntries)
        serverArchiveRows = $serverArchiveRows
        rowBudgets = $rowBudgets
        byteBudget = $byteBudget
    }
    $json = $metrics | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($resolvedOutput, "$json`n")
    $metrics | Format-List | Out-String | Write-Host
    Write-Host "MSI metrics JSON: $resolvedOutput"

    $violations = @()
    foreach ($metric in @("fileRows", "componentRows", "createFolderRows", "directoryRows")) {
        $limit = [int]$rowBudgets[$metric]
        if ($metrics[$metric] -gt $limit) {
            $violations += "$metric exceeds $limit"
        }
    }
    foreach ($metric in @("msiBytes", "installedFileBytes")) {
        if ($metrics[$metric] -gt $byteBudget) {
            $violations += "$metric exceeds $byteBudget bytes"
        }
    }
    if ($serverArchiveRows -ne 1) {
        $violations += "expected exactly one server.tar.zst File row; found $serverArchiveRows"
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
