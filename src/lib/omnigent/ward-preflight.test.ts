// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildOmnigentIdentityPrefix,
  composeOmnigentPrompt,
  WardPreflightError,
} from "./ward-preflight.ts";
import { evaluateFamiliarContract } from "../familiar-contract.ts";

const COMPLIANT_SOUL = `# SOUL.md - Who I Am

## I am Sage

My purpose is **understanding**.

## Core Work

I help my person read and synthesize.

## What I Am Not

- Not a code assistant.

## My Boundaries

- Don't invent citations. Ever.
`;

const COMPLIANT_IDENTITY = `# IDENTITY.md - Sage

- **Name:** Sage
- **Creature:** Research familiar in the Coven
- **Pronouns:** they/them

## Purpose

I help my person investigate things deeply.
`;

const COMPLIANT_WARD = `[meta]
version = "0.1.0"
familiar = "sage"
person = "val"

[protected]
files = [
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "ward.toml",
]
invariants = [
  "familiar.name == 'Sage'",
  "familiar.person == 'val'",
]

[editable]
paths = [
  "TOOLS.md",
  "HEARTBEAT.md",
]

[approval_tiers]

[approval_tiers.auto]
gate = "regression_suite"

[approval_tiers.human_review]
gate = "human_approval"
`;

test("buildOmnigentIdentityPrefix includes soul and identity sections", () => {
  const { prefix, included } = buildOmnigentIdentityPrefix({
    soul: COMPLIANT_SOUL,
    identity: COMPLIANT_IDENTITY,
    familiarId: "sage",
  });
  assert.deepEqual(included, ["SOUL.md", "IDENTITY.md"]);
  assert.match(prefix, /you are "sage"/);
  assert.match(prefix, /## SOUL\.md/);
  assert.match(prefix, /## IDENTITY\.md/);
  assert.match(prefix, /## Task/);
  assert.match(prefix, /I am Sage/);
});

test("buildOmnigentIdentityPrefix includes USER.md when present", () => {
  const { prefix, included } = buildOmnigentIdentityPrefix({
    soul: COMPLIANT_SOUL,
    identity: COMPLIANT_IDENTITY,
    user: "My person is Val. Prefer brief answers.",
    familiarId: "sage",
  });
  assert.deepEqual(included, ["SOUL.md", "IDENTITY.md", "USER.md"]);
  assert.match(prefix, /## USER\.md/);
  assert.match(prefix, /Prefer brief answers/);
});

test("buildOmnigentIdentityPrefix returns empty when no identity files", () => {
  const { prefix, included } = buildOmnigentIdentityPrefix({
    soul: null,
    identity: null,
  });
  assert.equal(prefix, "");
  assert.deepEqual(included, []);
});

test("composeOmnigentPrompt joins identity and task", () => {
  const { prefix } = buildOmnigentIdentityPrefix({
    soul: COMPLIANT_SOUL,
    identity: COMPLIANT_IDENTITY,
    familiarId: "sage",
  });
  const full = composeOmnigentPrompt("Summarize the paper", prefix);
  assert.match(full, /I am Sage/);
  assert.match(full, /Summarize the paper/);
  assert.ok(full.indexOf("Summarize the paper") > full.indexOf("## Task"));
});

test("composeOmnigentPrompt without prefix is the task alone", () => {
  assert.equal(composeOmnigentPrompt("  hello  ", ""), "hello");
});

test("compliant contract files pass evaluateFamiliarContract used by preflight", () => {
  const report = evaluateFamiliarContract({
    soul: COMPLIANT_SOUL,
    identity: COMPLIANT_IDENTITY,
    ward: COMPLIANT_WARD,
    memory: "# MEMORY\nnotes",
  });
  assert.equal(report.pass, true);
});

test("WardPreflightError formats violations", () => {
  const report = evaluateFamiliarContract({
    soul: null,
    identity: null,
    ward: null,
    memory: null,
  });
  assert.equal(report.pass, false);
  const err = new WardPreflightError("broken-fam", report);
  assert.equal(err.code, "WARD_PREFLIGHT_FAILED");
  assert.equal(err.familiarId, "broken-fam");
  assert.match(err.message, /Ward preflight failed/);
  assert.match(err.message, /SOUL\.md/);
});

// The escape hatch stays internal (review finding on #3216): the public
// sessions route must never forward a caller-supplied skipWardPreflight, so
// familiar-bound API runs always preflight. Source pin over the route.
test("the sessions route cannot relay skipWardPreflight from request bodies", () => {
  const route = readFileSync(
    new URL("../../app/api/omnigent/sessions/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /skipWardPreflight/, "the route never touches the escape hatch");
  assert.match(
    route,
    /createOmnigentRun\(config, \{/,
    "runs go through the shared resolver (which defaults the hatch to off)",
  );
});
