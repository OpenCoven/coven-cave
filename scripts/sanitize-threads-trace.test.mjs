import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Threads trace sanitization redacts headers and bodies while preserving archive members", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "threads-trace-test-"));
  try {
    const raw = path.join(root, "raw.zip");
    const output = path.join(root, "trace.zip");
    execFileSync("python3", ["-c", `import sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 z.writestr('test.network', 'Authorization: Bearer synthetic-token\\nx-coven-cave-local-peer: synthetic-peer')
 z.writestr('resources/body', '{"token":"synthetic-token","runId":"retained-run"}')
 z.writestr('resources/image.png', bytes([137,80,78,71,0,1,2]))
`, raw]);
    execFileSync("python3", ["scripts/sanitize-threads-trace.py", raw, output], { input: JSON.stringify(["synthetic-token", "synthetic-peer"]) });
    const entries = JSON.parse(execFileSync("python3", ["-c", `import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps({n:list(z.read(n)) for n in z.namelist()}))
`, output], { encoding: "utf8" }));
    assert.deepEqual(Object.keys(entries), ["test.network", "resources/body", "resources/image.png"]);
    assert.equal(Buffer.from(entries["test.network"]).toString(), "Authorization: Bearer [REDACTED]\nx-coven-cave-local-peer: [REDACTED]");
    assert.equal(Buffer.from(entries["resources/body"]).toString(), '{"token":"[REDACTED]","runId":"retained-run"}');
    assert.deepEqual(entries["resources/image.png"], [137,80,78,71,0,1,2]);
    assert.equal(statSync(output).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
