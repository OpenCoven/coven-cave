import assert from "node:assert/strict";
import {
  HARNESS_ONE_CLICK,
  NPM_INSTALL_TARGETS,
  isInstallTargetValue,
  parseOnboardingExecutorUrls,
} from "./onboarding-model.ts";

assert.deepEqual(
  parseOnboardingExecutorUrls(" https://one.example,https://two.example\nhttps://one.example "),
  ["https://one.example", "https://two.example"],
  "onboarding persists each executor once after normalizing user input",
);
assert.deepEqual(
  NPM_INSTALL_TARGETS,
  ["coven-cli", "codex", "claude", "copilot", "openclaw"],
  "the shared npm install lock covers every npm-backed target",
);
assert.ok(HARNESS_ONE_CLICK.codex?.command.includes("@openai/codex"));
assert.equal(isInstallTargetValue("codex"), true);
assert.equal(isInstallTargetValue("not-a-target"), false);
