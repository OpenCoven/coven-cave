import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const releaseScript = readFileSync(
  fileURLToPath(new URL("./release.sh", import.meta.url)),
  "utf8",
);
const sidecarScript = readFileSync(
  fileURLToPath(new URL("./sidecar-bundle.sh", import.meta.url)),
  "utf8",
);

test("macOS release signing includes node-pty spawn-helper Mach-O files", () => {
  assert.match(
    releaseScript,
    /-name "\*\.node" -o -name "spawn-helper" -o -perm \+111/,
  );
});

test("sidecar bundle restores executable mode for node-pty spawn-helper", () => {
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers\(\)/);
  assert.match(sidecarScript, /find "\$prebuilds" -path "\*\/darwin-\*\/spawn-helper"/);
  assert.match(sidecarScript, /chmod 755 "\$helper"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$NPM_STAGE\/node_modules"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$DEST\/node_modules"/);
});

test("notary rejection stops before stapling and prints the Apple log", () => {
  assert.match(releaseScript, /print_notary_log\(\)/);
  assert.match(releaseScript, /Submission in terminal status: Invalid/);
  assert.match(releaseScript, /Notary submission did not report Accepted/);
  assert.match(releaseScript, /run_notary_submit\n\n/);
  assert(
    releaseScript.indexOf("run_notary_submit") <
      releaseScript.indexOf('echo "==> Stapling notarization ticket"'),
  );
});

test("DMG packaging retries transient hdiutil resource-busy failures", () => {
  assert.match(releaseScript, /create_dmg_with_retry\(\)/);
  assert.match(releaseScript, /hdiutil detach "\$mount" -force/);
  assert.match(releaseScript, /Resource busy/);
  assert.match(releaseScript, /hdiutil create[\s\S]*"\$DMG_PATH"/);
  assert.match(releaseScript, /create_dmg_with_retry\n\n/);
  assert(
    releaseScript.indexOf("create_dmg_with_retry") <
      releaseScript.indexOf('echo "==> Signing DMG container"'),
  );
});
