// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./project-grant-targets.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ loadProjects, projectById \} from "@\/lib\/cave-projects";/,
  "grant-target validation uses the shared project loader helpers",
);
assert.match(
  source,
  /import \{ loadVisibleFamiliarRoster \} from "@\/lib\/server\/familiar-roster";/,
  "grant-target validation reuses the shared visible familiar roster loader",
);
assert.match(
  source,
  /import \{ isValidFamiliarId \} from "@\/lib\/server\/familiar-id";/,
  "grant-target validation uses the shared familiar id guard",
);
assert.match(
  source,
  /if \(!isValidFamiliarId\(input\.familiarId\)\) return \{ ok: false, status: 400, error: "invalid familiar id" \};/,
  "malformed familiar ids fail before any filesystem or roster access",
);
assert.match(
  source,
  /const project = projectById\(input\.projectId, await loadProjects\(\)\);[\s\S]*if \(!project\) return \{ ok: false, status: 404, error: "project not found" \};/,
  "unknown project ids are rejected",
);
assert.match(
  source,
  /const roster = await loadVisibleFamiliarRoster\(\);[\s\S]*if \(!roster\.ok\) return \{ ok: false, status: roster\.status === 401 \|\| roster\.status === 403 \? roster\.status : 503, error: roster\.error \};/,
  "roster failures fail closed while preserving auth statuses",
);
assert.match(
  source,
  /const familiar = roster\.roster\.find\(\(entry\) => entry\.id\.toLowerCase\(\) === input\.familiarId\.toLowerCase\(\)\);[\s\S]*if \(!familiar\) return \{ ok: false, status: 404, error: "familiar not found" \};/,
  "nonexistent or removed familiar ids are rejected",
);
assert.match(
  source,
  /return \{[\s\S]*ok: true,[\s\S]*familiarId: familiar\.id,[\s\S]*projectId: project\.id,[\s\S]*\};/,
  "successful validation returns canonical ids from the live roster and project registry",
);

console.log("project-grant-targets.test.ts: ok");
