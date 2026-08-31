import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);

async function workflow(name) {
  return parse(await readFile(new URL(`.github/workflows/${name}`, root), "utf8"));
}

function rustValidationScript(job) {
  return job.steps
    .map((step) => step.run)
    .filter((run) => typeof run === "string")
    .join("\n");
}

function assertDoctestInclusive(script, label) {
  assert.match(script, /(?:^|\n)cargo check --locked(?:\n|$)/m, `${label} must check Rust`);
  assert.match(
    script,
    /(?:^|\n)cargo test --locked(?:\n|$)/m,
    `${label} must run the default Cargo test surface, including rustdoc doctests`,
  );
  assert.doesNotMatch(
    script,
    /(?:^|\n)cargo test --locked --lib(?:\n|$)/m,
    `${label} must not narrow Cargo tests to library unit tests and skip doctests`,
  );
}

test("primary Rust validation keeps bare cargo test and CI coverage aligned", async () => {
  const [ci, full] = await Promise.all([
    workflow("ci.yml"),
    workflow("full-validation.yml"),
  ]);

  assertDoctestInclusive(rustValidationScript(ci.jobs.build), "CI build Rust validation");
  assertDoctestInclusive(rustValidationScript(full.jobs.rust), "release candidate Rust validation");
});
