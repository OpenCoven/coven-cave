# Windows equivalent of `lsof -d cwd -F pcn`, for the worktree lifecycle gate.
#
# Windows ships no lsof, and no built-in CLI exposes a process's current
# directory: `Get-CimInstance Win32_Process` and the deprecated `wmic` both carry
# CommandLine and ExecutablePath and neither carries the working directory. The
# working directory lives in the target process's own address space, in
# RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath, reachable from the PEB
# that NtQueryInformationProcess reports. Reading it needs P/Invoke, which
# PowerShell can do without shipping any binary or taking a native dependency.
#
# TWO probes run here, and they answer the same question through independent
# mechanisms because neither alone is sufficient for a gate that authorises
# deleting a worktree:
#
#   1. PEB read, per process. Exact, and names the pid and command — the
#      information an operator needs. Its blind spot is any process we cannot
#      open for PROCESS_VM_READ: processes of another user, service and
#      protected processes, and — the case that matters — a same-user process
#      running at a higher integrity level, e.g. an elevated shell.
#
#   2. Delete-share probe, per worktree root. Opening a directory for DELETE
#      access fails with ERROR_SHARING_VIOLATION while any process holds it as
#      its current directory, because the loader opens that handle with
#      FILE_SHARE_READ | FILE_SHARE_WRITE and no FILE_SHARE_DELETE. This asks
#      the filesystem rather than the process, so it sees holders that probe 1
#      cannot open at all. It opens a handle and closes it; it never deletes,
#      renames, or writes anything. Its own limit is depth: it answers only for
#      the exact directory probed, so a process whose cwd is a SUBDIRECTORY of
#      the worktree leaves the root reading FREE.
#
# Output is deliberately lsof's `-F pcn` record format after the `#records`
# marker, so the caller reuses the same parser — and the same partial-data
# fail-closed handling — that the POSIX path has always used.
#
# Exit code is 0 on a completed run. Any failure to produce a complete answer is
# reported by the absence of `#end`, by a `#hold ERROR:` verdict, or by a
# non-zero exit, all of which the caller treats as "cannot prove this worktree
# is unoccupied" and therefore as non-retirable.

[CmdletBinding()]
param(
  # A UTF-8 file of absolute directory paths, one per line, to delete-share
  # probe. A file rather than argv because the caller may have hundreds of
  # worktrees and a Windows command line is capped at 32767 characters.
  [Parameter(Mandatory = $true)][string]$PathsFile
)

$ErrorActionPreference = 'Stop'
# PowerShell 5.1 writes a redirected stdout in the console's OEM code page,
# which mangles any non-ASCII path. The caller decodes UTF-8.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CovenCwdProbe {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ReadProcessMemory(IntPtr handle, IntPtr address, byte[] buffer, IntPtr size, out IntPtr read);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool IsWow64Process(IntPtr handle, out bool isWow64);
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, byte[] info, int infoLength, out int returnLength);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

  const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const int PROCESS_VM_READ = 0x0010;
  const int ProcessBasicInformation = 0;
  const int ProcessWow64Information = 26;

  // RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath, and the PEB field
  // pointing at those parameters. Stable across Windows releases, but never
  // trusted on that reputation: the caller re-derives its OWN current directory
  // through this exact code path on every run and refuses the whole probe if the
  // answer does not match the directory it launched this script in.
  const int PEB64_PROCESS_PARAMETERS = 0x20;
  const int PARAMS64_CURRENT_DIRECTORY = 0x38;
  const int PEB32_PROCESS_PARAMETERS = 0x10;
  const int PARAMS32_CURRENT_DIRECTORY = 0x24;

  static byte[] Read(IntPtr handle, long address, int length) {
    byte[] buffer = new byte[length];
    IntPtr read;
    if (!ReadProcessMemory(handle, new IntPtr(address), buffer, new IntPtr(length), out read)) return null;
    if (read.ToInt64() != length) return null;
    return buffer;
  }

  /// The process's current directory, or null when it cannot be read.
  public static string CurrentDirectory(int pid) {
    if (pid <= 0) return null;
    IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, pid);
    if (handle == IntPtr.Zero) return null;
    try {
      bool isWow64 = false;
      if (!IsWow64Process(handle, out isWow64)) return null;
      return isWow64 ? Wow64CurrentDirectory(handle) : NativeCurrentDirectory(handle);
    } catch {
      return null;
    } finally {
      CloseHandle(handle);
    }
  }

  static string NativeCurrentDirectory(IntPtr handle) {
    if (IntPtr.Size != 8) return null;
    byte[] basic = new byte[48];
    int returned;
    if (NtQueryInformationProcess(handle, ProcessBasicInformation, basic, basic.Length, out returned) != 0) return null;
    long peb = BitConverter.ToInt64(basic, 8);
    if (peb == 0) return null;
    byte[] pointer = Read(handle, peb + PEB64_PROCESS_PARAMETERS, 8);
    if (pointer == null) return null;
    long parameters = BitConverter.ToInt64(pointer, 0);
    if (parameters == 0) return null;
    // UNICODE_STRING { USHORT Length; USHORT MaximumLength; PWSTR Buffer; }
    byte[] unicodeString = Read(handle, parameters + PARAMS64_CURRENT_DIRECTORY, 16);
    if (unicodeString == null) return null;
    int length = BitConverter.ToUInt16(unicodeString, 0);
    long buffer = BitConverter.ToInt64(unicodeString, 8);
    return ReadString(handle, buffer, length);
  }

  static string Wow64CurrentDirectory(IntPtr handle) {
    byte[] pebPointer = new byte[IntPtr.Size];
    int returned;
    if (NtQueryInformationProcess(handle, ProcessWow64Information, pebPointer, pebPointer.Length, out returned) != 0) return null;
    long peb = IntPtr.Size == 8 ? BitConverter.ToInt64(pebPointer, 0) : (uint)BitConverter.ToInt32(pebPointer, 0);
    if (peb == 0) return null;
    byte[] pointer = Read(handle, peb + PEB32_PROCESS_PARAMETERS, 4);
    if (pointer == null) return null;
    long parameters = (uint)BitConverter.ToInt32(pointer, 0);
    if (parameters == 0) return null;
    byte[] unicodeString = Read(handle, parameters + PARAMS32_CURRENT_DIRECTORY, 8);
    if (unicodeString == null) return null;
    int length = BitConverter.ToUInt16(unicodeString, 0);
    long buffer = (uint)BitConverter.ToInt32(unicodeString, 4);
    return ReadString(handle, buffer, length);
  }

  static string ReadString(IntPtr handle, long buffer, int byteLength) {
    if (buffer == 0 || byteLength <= 0 || byteLength > 0x8000) return null;
    byte[] raw = Read(handle, buffer, byteLength);
    if (raw == null) return null;
    string value = Encoding.Unicode.GetString(raw).TrimEnd('\0');
    return value.Length == 0 ? null : value;
  }

  const uint DELETE_ACCESS = 0x00010000;
  const uint SHARE_READ_WRITE_DELETE = 0x00000007;
  const uint OPEN_EXISTING = 3;
  const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  const int ERROR_SHARING_VIOLATION = 32;

  /// "FREE", "HELD", or "ERROR:<win32 code>". Opens and closes a handle; the
  /// DELETE access right is requested, never exercised — nothing is unlinked.
  public static string DeleteShareVerdict(string directory) {
    IntPtr handle = CreateFileW(directory, DELETE_ACCESS, SHARE_READ_WRITE_DELETE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero);
    if (handle == IntPtr.Zero || handle == new IntPtr(-1)) {
      int code = Marshal.GetLastWin32Error();
      return code == ERROR_SHARING_VIOLATION ? "HELD" : ("ERROR:" + code);
    }
    CloseHandle(handle);
    return "FREE";
  }
}
'@

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('#probe windows-process-cwd v1')

# The self-check, and note what is NOT emitted here: this line carries only the
# probe's pid, never its directory. The caller already knows what directory this
# process is in — it chose it — and it goes looking for that pid among the
# ordinary records below, which are produced by the same memory reads as every
# other process. So the check passes only if the read path actually works: a
# probe that emitted its own directory from a cheap local call would answer
# correctly while every real read failed, which is precisely the silent
# degradation — "no live process anywhere" — that this exists to catch.
$lines.Add("#selfpid $([System.Diagnostics.Process]::GetCurrentProcess().Id)")

$total = 0
$read = 0
$records = New-Object System.Collections.Generic.List[string]
foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
  $total++
  $pid_ = 0
  $name = $null
  try { $pid_ = $process.Id; $name = $process.ProcessName } catch { }
  if ($pid_ -le 0 -or [string]::IsNullOrEmpty($name)) { continue }
  $cwd = $null
  try { $cwd = [CovenCwdProbe]::CurrentDirectory($pid_) } catch { }
  if (-not $cwd) { continue }
  $read++
  # lsof -F pcn: p<pid>, c<command>, f<fd>, n<name>.
  $records.Add("p$pid_")
  $records.Add("c$name")
  $records.Add('fcwd')
  $records.Add("n$cwd")
}
$lines.Add("#processes total=$total read=$read unreadable=$($total - $read)")

foreach ($directory in [System.IO.File]::ReadAllLines($PathsFile, (New-Object System.Text.UTF8Encoding($false)))) {
  if ([string]::IsNullOrWhiteSpace($directory)) { continue }
  $verdict = 'ERROR:0'
  try { $verdict = [CovenCwdProbe]::DeleteShareVerdict($directory) } catch { $verdict = 'ERROR:0' }
  $lines.Add("#hold $verdict $directory")
}

$lines.Add('#records')
foreach ($record in $records) { $lines.Add($record) }
# Written last and checked by the caller: its absence is how a truncated or
# aborted run is told apart from a run that genuinely saw nothing.
$lines.Add('#end')

[Console]::Out.Write([string]::Join("`n", $lines) + "`n")
exit 0
