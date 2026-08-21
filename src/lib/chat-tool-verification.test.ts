import assert from "node:assert/strict";
import test from "node:test";
import { verificationEvidenceFromTool } from "./chat-tool-verification.ts";

const tool = (overrides: Record<string, unknown>) => ({
  id: "call-1",
  name: "Bash",
  input: JSON.stringify({ command: "pnpm test:app" }),
  status: "ok" as const,
  ...overrides,
});

test("known project verification commands become structured evidence", () => {
  assert.deepEqual(verificationEvidenceFromTool(tool({})), {
    id: "verified:test:call-1",
    kind: "test",
    label: "App tests passed",
    state: "passed",
    source: "verified-event",
  });
  assert.equal(verificationEvidenceFromTool(tool({ status: "running" }))?.state, "running");
  assert.equal(verificationEvidenceFromTool(tool({ status: "error" }))?.state, "failed");
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm typecheck" }) }))?.kind,
    "typecheck",
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm lint" }) }))?.kind,
    "lint",
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm build" }) }))?.kind,
    "build",
  );
  assert.equal(verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm test" }) }))?.kind, "test");
  assert.equal(
    verificationEvidenceFromTool(
      tool({ input: JSON.stringify({ command: "pnpm test:e2e src/app/chat.spec.ts" }) }),
    )?.label,
    "App tests passed",
  );
  assert.equal(
    verificationEvidenceFromTool(
      tool({ input: JSON.stringify({ command: "pnpm test:app src/lib/chat-tool-verification.test.ts" }) }),
    )?.kind,
    "test",
  );
});

test("generic success, output claims, compound shell, and unknown kinds are rejected", () => {
  assert.equal(verificationEvidenceFromTool(tool({ name: "Read", input: "package.json" })), null);
  assert.equal(verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "echo tests passed" }) })), null);
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm test:app\npwd" }) })),
    null,
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm test:app\rcmd" }) })),
    null,
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm test:app && rm -rf build" }) })),
    null,
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm test:e2e --list" }) })),
    null,
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm test:e2e --help" }) })),
    null,
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "custom-verifier" }), output: "All tests passed" })),
    null,
  );
  assert.equal(verificationEvidenceFromTool(tool({ input: "{not json" })), null);
});
