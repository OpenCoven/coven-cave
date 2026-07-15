# Windows upgrade benchmark

`scripts/windows-upgrade-diagnostics.ps1` captures one Windows MSI upgrade as
a reproducible diagnostic bundle. It records the candidate's MSI metadata and
SHA-256, installed versions, MSI action evidence, CPU and I/O counter samples,
MSI Installer and Restart Manager events, relevant process trees, sidecar
readiness, interactive readiness, and an atomic `summary.json`.

The default invocation is a non-mutating preflight:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-upgrade-diagnostics.ps1 `
  -CandidateMsiPath C:\path\to\CovenCave_0.0.173_x64_en-US.msi `
  -OutputDirectory C:\temp\coven-upgrade-0172-0173
```

Review `summary.json`, then run the measured upgrade from an elevated
PowerShell. Both expected versions and explicit installation authorization are
required:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-upgrade-diagnostics.ps1 `
  -CandidateMsiPath C:\path\to\CovenCave_0.0.173_x64_en-US.msi `
  -OutputDirectory C:\temp\coven-upgrade-0172-0173 `
  -ExpectedFromVersion 0.0.172 `
  -ExpectedToVersion 0.0.173 `
  -AllowInstall
```

An HTTPS `-CandidateUrl` may be used instead of a local path. The downloaded
MSI is retained beside the diagnostics and hashed before execution.

## Measurement boundaries

The v0.0.172 to v0.0.173 measurement is classified as
`legacy-expanded-msi-bridge`. It includes removal of v0.0.172's roughly 24,000
expanded sidecar components, so it is not a steady-state result. Use a
v0.0.173-or-newer source and the next candidate to measure the representative
`archive-to-archive` path.

The harness invokes only `msiexec /i` with `/passive`, `/norestart`,
`REBOOT=ReallySuppress`, and `/L*V`. It does not uninstall the product, delete
application data, or stop application processes itself. On timeout it records
a partial summary and deliberately leaves Windows Installer running so the MSI
engine can complete or roll back safely. Run the benchmark on a machine where
an update and application relaunch are acceptable.

After a successful MSI transaction, the harness starts the installed app when
Restart Manager has not already done so. Sidecar readiness is the first
listening socket owned by a packaged Node descendant. Interactive readiness is
the first responsive CovenCave process with a main window. Pass
`-SkipReadiness` only when measuring the MSI transaction in isolation.

Process command lines and event messages are redacted for CovenCave access
tokens before being written. Review the bundle before sharing it because paths,
process identifiers, and Windows event messages can still identify the host.

The deterministic fixture test is safe to run at any time:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-upgrade-diagnostics.test.ps1
```
