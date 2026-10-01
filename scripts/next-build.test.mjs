import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeEnvOverrideNotice, productionBuildEnv } from "./next-build.mjs";

test("the build always runs with NODE_ENV=production (#5701)", () => {
  assert.equal(productionBuildEnv({ NODE_ENV: "development", PATH: "/bin" }).NODE_ENV, "production");
  assert.equal(productionBuildEnv({}).NODE_ENV, "production");
  assert.equal(productionBuildEnv({ PATH: "/bin" }).PATH, "/bin", "the rest of the environment passes through");
});

test("an overridden NODE_ENV is named; production or unset is silent", () => {
  assert.match(nodeEnvOverrideNotice({ NODE_ENV: "development" }), /NODE_ENV=development is ignored/);
  assert.equal(nodeEnvOverrideNotice({ NODE_ENV: "production" }), null);
  assert.equal(nodeEnvOverrideNotice({}), null);
  assert.equal(nodeEnvOverrideNotice({ NODE_ENV: "" }), null);
});

test("pnpm build goes through the wrapper", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /^node scripts\/next-build\.mjs && pnpm build:server$/);
});
