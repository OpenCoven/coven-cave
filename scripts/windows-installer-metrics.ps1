param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [Parameter(Mandatory = $true)][string]$OutputJson,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$AdminLog
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-TableCount {
  param(
    [Parameter(Mandatory = $true)]$Database,
    [Parameter(Mandatory = $true)][string]$TableName
  )

  $view = $null
  $record = $null
  try {
    $view = $Database.OpenView("SELECT COUNT(*) FROM ``$TableName``")
    $view.Execute()
    $record = $view.Fetch()
    if ($null -eq $record) { throw "MSI table query returned no row: $TableName" }
    return [int64]$record.IntegerData(1)
  }
  finally {
    if ($null -ne $view) { $view.Close() }
    if ($null -ne $record) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
    if ($null -ne $view) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
  }
}

$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$msiInfo = Get-Item -LiteralPath $resolvedMsi
$resolvedOutputJson = [IO.Path]::GetFullPath($OutputJson)
$resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$resolvedAdminLog = [IO.Path]::GetFullPath($AdminLog)

New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($resolvedOutputJson)) | Out-Null
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($resolvedAdminLog)) | Out-Null
if (Test-Path -LiteralPath $resolvedOutputDirectory) {
  $existing = @(Get-ChildItem -LiteralPath $resolvedOutputDirectory -Force)
  if ($existing.Count -gt 0) {
    throw "Administrative output directory must be empty: $resolvedOutputDirectory"
  }
}
else {
  New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory | Out-Null
}

$installer = $null
$database = $null
try {
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.OpenDatabase($resolvedMsi, 0)
  $fileRows = Get-TableCount $database "File"
  $componentRows = Get-TableCount $database "Component"
  $directoryRows = Get-TableCount $database "Directory"
  $createFolderRows = Get-TableCount $database "CreateFolder"

  $arguments = @(
    "/a",
    "`"$resolvedMsi`"",
    "/qn",
    "TARGETDIR=`"$resolvedOutputDirectory`"",
    "/L*V",
    "`"$resolvedAdminLog`""
  )
  $admin = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
  if ($admin.ExitCode -ne 0) {
    throw "msiexec administrative install failed with exit code $($admin.ExitCode); log: $resolvedAdminLog"
  }

  $adminFiles = @(Get-ChildItem -LiteralPath $resolvedOutputDirectory -Recurse -File -Force)
  $administrativeBytes = [int64](($adminFiles | Measure-Object -Property Length -Sum).Sum)
  $manifestFile = $adminFiles | Where-Object { $_.Name -eq "server-manifest.json" } | Select-Object -First 1
  if ($null -eq $manifestFile) { throw "Administrative image has no server-manifest.json" }
  $runtimeManifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json

  $expandedRoots = @(Get-ChildItem -LiteralPath $resolvedOutputDirectory -Recurse -Directory -Force |
    Where-Object { $_.FullName -match '[\\/]resources[\\/]server$' })
  $expandedServerFiles = 0
  foreach ($root in $expandedRoots) {
    $expandedServerFiles += @(Get-ChildItem -LiteralPath $root.FullName -Recurse -File -Force).Count
  }

  $metrics = [ordered]@{
    msiBytes = [int64]$msiInfo.Length
    fileRows = $fileRows
    componentRows = $componentRows
    directoryRows = $directoryRows
    createFolderRows = $createFolderRows
    administrativeFiles = [int64]$adminFiles.Count
    administrativeBytes = $administrativeBytes
    expandedServerFiles = [int64]$expandedServerFiles
    runtimeArchive = [ordered]@{
      archiveBytes = [int64]$runtimeManifest.archiveBytes
      unpackedBytes = [int64]$runtimeManifest.unpackedBytes
      fileCount = [int64]$runtimeManifest.fileCount
    }
  }
  $metrics | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resolvedOutputJson -Encoding utf8
  Write-Host "Windows installer metrics written to $resolvedOutputJson"
}
finally {
  if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
  if ($null -ne $installer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
}
