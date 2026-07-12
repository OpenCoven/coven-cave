import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows upgrade smoke exercises a bounded previous-to-current MSI upgrade", async () => {
  const script = await readFile(new URL("./windows-upgrade-smoke.ps1", import.meta.url), "utf8");

  for (const parameter of ["CurrentMsi", "CurrentTag", "OutputDirectory", "MaxSeconds"]) {
    assert.match(script, new RegExp(`\\$${parameter}`), `upgrade smoke must accept -${parameter}`);
  }
  assert.match(script, /Invoke-GhJson @\("release", "list"/, "upgrade smoke must discover stable GitHub releases through gh");
  assert.match(script, /IsDraft[\s\S]*IsPrerelease[\s\S]*CurrentTag/i, "current, draft, and prerelease tags must be excluded");
  assert.match(script, /\.name -match '\\\.msi\$'/, "release discovery must select an MSI asset");
  assert.match(script, /gh release download/, "upgrade smoke must download the selected previous MSI asset");
  assert.match(script, /previous[\s\S]*msiexec\.exe[\s\S]*["']\/i["']/i, "upgrade smoke must install the previous MSI");
  assert.match(script, /Find-CovenExecutable[\s\S]*Start-Process -FilePath \$oldExecutable/, "upgrade smoke must launch the previous desktop app");
  assert.match(script, /Start-Process -FilePath \$newExecutable/, "upgrade smoke must launch the upgraded desktop app");
  assert.match(script, /Get-CimInstance[\s\S]*Win32_Process/, "upgrade smoke must inspect the real Windows process tree");
  assert.match(script, /ParentProcessId/, "bundled Node must be attributed to the desktop parent process");
  assert.match(script, /resources[\s\S]*node[\s\S]*bin[\s\S]*node\.exe/i, "only the bundled Node child counts as sidecar evidence");
  assert.match(script, /current upgrade[\s\S]*msiexec\.exe[\s\S]*\/L\*V/i, "current MSI upgrade must retain a verbose log");
  assert.match(script, /WaitForExit\(\$MaxSeconds \* 1000\)/, "upgrade must enforce the configured hard timeout");
  assert.match(script, /ExitCode -ne 0/, "every nonzero installer exit, including reboot-required 3010, must fail");
  assert.match(script, /Assert-ProcessesGone/, "old app and Node PIDs must be proven gone");
  assert.match(script, /Ready on http:\/\//, "post-upgrade sidecar log must reach its ready marker");
  assert.match(script, /no-previous-msi/, "repositories without an earlier MSI need a machine-readable skip reason");
  assert.match(script, /finally[\s\S]*ConvertTo-Json/i, "timing, process, and cleanup evidence must be written even on failure");
});

test("Windows release validates locally before any MSI publication", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  const tauriAction = workflow.indexOf("name: Build with tauri-action");
  const localBuild = workflow.indexOf("name: Build Windows MSI locally");
  const metrics = workflow.indexOf("name: Collect Windows installer metrics");
  const budget = workflow.indexOf("name: Enforce Windows installer budgets");
  const upgrade = workflow.indexOf("name: Smoke previous-to-current Windows upgrade");
  const diagnostics = workflow.indexOf("name: Upload Windows validation diagnostics");
  const sign = workflow.indexOf("name: Sign validated Windows updater artifact");
  const upload = workflow.indexOf("name: Upload validated Windows artifacts");

  assert.ok(tauriAction >= 0, "Linux publishing action must remain present");
  assert.match(
    workflow.slice(tauriAction, workflow.indexOf("uses:", tauriAction)),
    /matrix\.family == 'linux'/,
    "publishing tauri-action must be Linux-only",
  );
  for (const [label, index] of Object.entries({ localBuild, metrics, budget, upgrade, diagnostics, sign, upload })) {
    assert.ok(index >= 0, `workflow is missing ${label}`);
  }
  assert.ok(localBuild < metrics && metrics < budget && budget < upgrade, "build, metrics, budget, and upgrade must be ordered");
  assert.ok(upgrade < sign && sign < upload, "no MSI or signature may publish before upgrade validation");
  assert.ok(diagnostics < sign, "diagnostic retention must be configured before signing/upload");
  assert.match(
    workflow.slice(diagnostics, diagnostics + 500),
    /if:.*always\(\)/s,
    "verbose installer logs and JSON evidence must upload even when validation fails",
  );
  assert.match(workflow.slice(localBuild, localBuild + 500), /pnpm exec tauri build/, "Windows must build locally");
  assert.match(workflow.slice(metrics, metrics + 1_200), /windows-installer-metrics\.ps1/, "workflow must run exact MSI metrics");
  assert.match(workflow.slice(budget, budget + 500), /windows-installer-budget\.mjs/, "workflow must enforce the pure budget gate");
  assert.match(workflow.slice(upgrade, upgrade + 1_000), /windows-upgrade-smoke\.ps1/, "workflow must run the real upgrade gate");
});
