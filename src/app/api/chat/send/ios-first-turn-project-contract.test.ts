import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("ordinary first turns authorize the submitted project before launch", () => {
  assert.match(
    source,
    /const projectRootForLaunch = body\.projectRoot \?\? resumeCwd;/,
    "the route should prefer the client project root while retaining trusted resume provenance",
  );
  assert.match(
    source,
    /authorizeChatProjectLaunch\([\s\S]*familiarId: body\.familiarId,[\s\S]*projectRoot: projectRootForLaunch,[\s\S]*surface: "chat"/,
    "every ordinary chat launch should pass through the shared familiar/project authorization gate",
  );
});

test("project launch failures return the structured envelope consumed by iOS", () => {
  assert.match(
    source,
    /if \(error instanceof ChatProjectLaunchError\) \{[\s\S]*JSON\.stringify\(\{[\s\S]*ok: false,[\s\S]*error: error\.message,[\s\S]*code: error\.code,[\s\S]*status: error\.status,[\s\S]*"content-type": "application\/json"/,
    "the route should preserve actionable project error code, message, and HTTP status",
  );
});
