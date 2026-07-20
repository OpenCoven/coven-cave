import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./onboarding-model.ts", import.meta.url), "utf8");

assert.match(source, /export const INSTALL_TARGET_KIND/, "the install protocol has a single model owner");
assert.match(source, /export const NPM_INSTALL_TARGETS/, "npm serialization remains explicit");
assert.match(source, /export const HARNESS_ONE_CLICK/, "runtime install instructions remain centralized");
assert.match(source, /export const PLATFORM_COPY/, "native platform guidance remains data-driven");
assert.match(source, /export function parseOnboardingExecutorUrls/, "multi-host URL normalization remains reusable");
