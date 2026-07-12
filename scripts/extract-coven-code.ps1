param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$MemberName,

  [Parameter(Mandatory = $true, Position = 2)]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
  $entries = @($archive.Entries | Where-Object { $_.FullName -ceq $MemberName })
  if ($entries.Count -ne 1) {
    throw "expected exactly one Coven Code archive entry named '$MemberName'; found $($entries.Count)"
  }

  [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $OutputPath, $true)
} finally {
  $archive.Dispose()
}
