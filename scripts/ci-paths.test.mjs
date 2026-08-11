import assert from "node:assert/strict";
import test from "node:test";

import { classifyCiPaths } from "./ci-paths.mjs";

test("documentation-only changes run only the baseline CI contract", () => {
  assert.deepEqual(classifyCiPaths(["docs/ci.md", "README.md"]), {
    frontend: false,
    rust: false,
    e2e: false,
    ios: false,
  });
});

test("workflow and script changes run frontend validation", () => {
  assert.deepEqual(classifyCiPaths([".github/workflows/ci.yml"]), {
    frontend: true,
    rust: false,
    e2e: false,
    ios: true,
  });
  assert.equal(classifyCiPaths(["scripts/run-tests.mjs"]).frontend, true);
  assert.equal(classifyCiPaths(["scripts/run-tests.mjs"]).ios, false);
});

test("Rust-only changes avoid frontend and E2E work", () => {
  assert.deepEqual(classifyCiPaths(["src-tauri/src/main.rs"]), {
    frontend: false,
    rust: true,
    e2e: false,
    ios: false,
  });
});

test("user-facing frontend changes include E2E", () => {
  assert.deepEqual(classifyCiPaths(["src/components/chat.tsx"]), {
    frontend: true,
    rust: false,
    e2e: true,
    ios: false,
  });
});

test("shared dependency changes exercise every relevant web gate", () => {
  assert.deepEqual(classifyCiPaths(["pnpm-lock.yaml", "src-tauri/Cargo.lock"]), {
    frontend: true,
    rust: true,
    e2e: true,
    ios: true,
  });
});

test("root runtime hooks receive frontend and end-to-end validation", () => {
  assert.deepEqual(classifyCiPaths(["instrumentation.ts"]), {
    frontend: true,
    rust: false,
    e2e: true,
    ios: false,
  });
});

test("iOS sources and generators request the macOS build", () => {
  assert.deepEqual(classifyCiPaths(["apps/ios/CovenCave/CovenCave/State/AppModel.swift"]), {
    frontend: false,
    rust: false,
    e2e: false,
    ios: true,
  });
  for (const path of [
    "scripts/ios-xcodegen.sh",
    "scripts/build-ios-markdown.mjs",
    "scripts/build-ios-terminal.mjs",
    "scripts/ci-paths.mjs",
  ]) {
    assert.equal(classifyCiPaths([path]).ios, true, path);
  }
});
