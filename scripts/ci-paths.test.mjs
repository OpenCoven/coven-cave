import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyCiPaths } from "./ci-paths.mjs";

test("documentation changes run the docs contract and nothing heavier", () => {
  assert.deepEqual(classifyCiPaths(["docs/ci.md", "README.md"]), {
    frontend: false,
    rust: false,
    e2e: false,
    ios: false,
    docs: true,
  });
  // A root markdown file is not under docs/, so it stays fully baseline.
  assert.equal(classifyCiPaths(["README.md"]).docs, false);
});

test("workflow and script changes run frontend validation", () => {
  assert.deepEqual(classifyCiPaths([".github/workflows/ci.yml"]), {
    frontend: true,
    rust: false,
    e2e: false,
    ios: true,
    docs: false,
  });
  assert.equal(classifyCiPaths(["scripts/run-tests.mjs"]).frontend, true);
  assert.equal(classifyCiPaths(["scripts/run-tests.mjs"]).ios, false);
});

test("protocol changes run conformance in normal Linux pull-request CI", () => {
  assert.equal(
    classifyCiPaths(["schemas/research/v1/run-manifest.schema.json"]).frontend,
    true,
  );

  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const frontendValidation = workflow.match(
    /^  frontend-validation:\n[\s\S]*?(?=^  [a-z][a-z-]+:\n)/m,
  )?.[0];
  assert.ok(frontendValidation, "CI must retain the frontend validation job");
  assert.match(workflow, /^  pull_request:\n/m);
  assert.match(frontendValidation, /^    runs-on: ubuntu-latest$/m);
  assert.match(
    frontendValidation,
    /^          - name: protocol conformance\n            command: test:conformance$/m,
  );
});

test("Rust-only changes avoid frontend and E2E work", () => {
  assert.deepEqual(classifyCiPaths(["src-tauri/src/main.rs"]), {
    frontend: false,
    rust: true,
    e2e: false,
    ios: false,
    docs: false,
  });
});

test("user-facing frontend changes include E2E", () => {
  assert.deepEqual(classifyCiPaths(["src/components/chat.tsx"]), {
    frontend: true,
    rust: false,
    e2e: true,
    ios: false,
    docs: false,
  });
});

test("shared dependency changes exercise every relevant web gate", () => {
  assert.deepEqual(classifyCiPaths(["pnpm-lock.yaml", "src-tauri/Cargo.lock"]), {
    frontend: true,
    rust: true,
    e2e: true,
    ios: true,
    docs: false,
  });
});

test("root runtime hooks receive frontend and end-to-end validation", () => {
  assert.deepEqual(classifyCiPaths(["instrumentation.ts"]), {
    frontend: true,
    rust: false,
    e2e: true,
    ios: false,
    docs: false,
  });
});

test("iOS sources and generators request the macOS build", () => {
  assert.deepEqual(classifyCiPaths(["apps/ios/CovenCave/CovenCave/State/AppModel.swift"]), {
    frontend: false,
    rust: false,
    e2e: false,
    ios: true,
    docs: false,
  });
  for (const path of [
    "scripts/ios-xcodegen.sh",
    "scripts/build-ios-markdown.mjs",
    "scripts/ci-paths.mjs",
  ]) {
    assert.equal(classifyCiPaths([path]).ios, true, path);
  }
});

test("public client v1 changes run Cave API, E2E, and documentation validation", () => {
  for (const file of [
    "src/lib/server/client-v1/contract.ts",
    "src/lib/server/client-v1/discovery.test.ts",
    "src/lib/server/client-v1/runtime.ts",
    "src/lib/server/client-v1/contract-fixture.json",
    "scripts/export-client-v1-contract.mjs",
    "src/app/api/client/v1/health/route.ts",
    "src/app/api/client/v1/health/route.test.ts",
    "src/app/api/api-contracts.test.ts",
    "docs/api/client-v1.md",
    ".gitattributes",
  ]) {
    const paths = classifyCiPaths([file]);
    assert.equal(paths.frontend, true, `${file} must run Cave API validation`);
    assert.equal(paths.e2e, true, `${file} must run E2E validation`);
    assert.equal(paths.docs, true, `${file} must run documentation validation`);
  }
});
