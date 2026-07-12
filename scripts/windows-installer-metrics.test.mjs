import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows installer metrics query MSI tables and administrative contents", async () => {
  const script = await readFile(new URL("./windows-installer-metrics.ps1", import.meta.url), "utf8");

  for (const parameter of ["MsiPath", "OutputJson", "OutputDirectory", "AdminLog"]) {
    assert.match(script, new RegExp(`\\$${parameter}`), `collector must accept -${parameter}`);
  }
  assert.match(script, /WindowsInstaller\.Installer/, "collector must use the Windows Installer COM database API");
  assert.match(script, /OpenDatabase/, "collector must open the MSI read-only database");
  for (const table of ["File", "Component", "Directory", "CreateFolder"]) {
    assert.match(script, new RegExp(`Get-TableCount[^\n]*["']${table}["']`), `collector must query the ${table} table`);
  }
  assert.match(script, /Start-Process -FilePath ["']msiexec\.exe["']/, "collector must invoke Windows Installer directly");
  assert.match(script, /["']\/a["']/, "collector must perform an administrative install");
  assert.match(script, /["']\/L\*V["']/, "administrative install must retain a verbose Windows Installer log");
  assert.match(script, /server-manifest\.json/, "collector must read the generated sidecar manifest");
  assert.match(
    script,
    /expandedRoots[\s\S]*FullName -match [\s\S]*resources[\s\S]*server\$/,
    "collector must detect an accidentally expanded resources/server tree",
  );
  for (const field of [
    "msiBytes",
    "fileRows",
    "componentRows",
    "directoryRows",
    "createFolderRows",
    "administrativeFiles",
    "administrativeBytes",
    "expandedServerFiles",
    "runtimeArchive",
  ]) {
    assert.match(script, new RegExp(`${field}\\s*=`), `collector output must include ${field}`);
  }
});
