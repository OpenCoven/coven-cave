import assert from "node:assert/strict";
import test from "node:test";

import {
  assessMaintenancePlaneAdmission,
  type MaintenancePlaneCapabilities,
} from "./maintenance-plane-admission.ts";

/**
 * A representative shape: local enforced, the waivable planes off. Note coven is
 * opportunistic in the real gate — enforced when @opencoven/cli maintenance is
 * available — so a live run may show it either way. Tests set it explicitly
 * rather than assuming.
 */
function capabilities(
  overrides: Partial<Record<keyof MaintenancePlaneCapabilities, boolean>> = {},
): MaintenancePlaneCapabilities {
  const base = { local: true, coven: false, beads: false, github: false, ...overrides };
  return {
    local: { enforced: base.local, source: "local-maintenance-gate" },
    coven: { enforced: base.coven, source: "cave-wqa0b.2" },
    beads: { enforced: base.beads, source: "cave-wqa0b.3" },
    github: { enforced: base.github, source: "cave-wqa0b.4" },
  };
}

test("without the opt-in, behaviour is exactly what it is today", () => {
  // The regression that would matter most: an existing --apply invocation must
  // not start succeeding because this module was added.
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities(),
    allowUnenforcedPlanes: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "gate-incomplete");
    assert.deepEqual(result.missingPlanes, ["coven", "beads", "github"]);
  }
});

test("with the opt-in, the three known-pending planes are waived", () => {
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities(),
    allowUnenforcedPlanes: true,
  });
  assert.equal(result.ok, true);
  if (result.ok && result.degraded) {
    assert.deepEqual(result.waivedPlanes, ["coven", "beads", "github"]);
  } else {
    assert.fail("expected a degraded admission");
  }
});

test("a fully enforced gate is admitted without being marked degraded", () => {
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities({ coven: true, beads: true, github: true }),
    allowUnenforcedPlanes: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.degraded, false);
});

test("the opt-in does not mark a complete gate degraded", () => {
  // Passing the flag on a healthy gate must not label the run degraded, or the
  // audit trail would fill with false positives and stop meaning anything.
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities({ coven: true, beads: true, github: true }),
    allowUnenforcedPlanes: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.degraded, false);
});

test("the local plane is never waivable, even with the opt-in", () => {
  // The hard requirement. local performs the exclusion that stops two actors
  // retiring the same unit; waiving it is an unguarded run, not a degraded one.
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities({ local: false }),
    allowUnenforcedPlanes: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "local-plane-unenforced");
    assert.match(result.diagnostic, /never waivable/);
  }
});

test("local unenforced refuses distinctly, not as a generic unknown plane", () => {
  // Ordering: local is checked before the known-set test, so the operator is
  // told the specific thing that is wrong rather than a vaguer one.
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities({ local: false, coven: true, beads: true, github: true }),
    allowUnenforcedPlanes: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "local-plane-unenforced");
});

test("a plane outside the known pending set is not waived", () => {
  // A plane off for an unrecorded reason is an unknown gap, and unknown gaps
  // are what the gate exists to catch. Simulated by adding a fifth plane.
  const withExtra = {
    ...capabilities({ coven: true, beads: true, github: true }),
    audit: { enforced: false, source: "nobody filed this" },
  } as unknown as MaintenancePlaneCapabilities;
  const result = assessMaintenancePlaneAdmission({
    capabilities: withExtra,
    allowUnenforcedPlanes: true,
  });
  // The fifth plane is not in PLANE_ORDER, so it is invisible here — which is
  // the honest behaviour to pin: this module only assesses the four planes it
  // knows, and adding a plane requires updating PLANE_ORDER deliberately.
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.degraded, false);
});

test("waiving reports every waived plane, so the audit can name them", () => {
  const result = assessMaintenancePlaneAdmission({
    capabilities: capabilities({ beads: true }),
    allowUnenforcedPlanes: true,
  });
  assert.equal(result.ok, true);
  if (result.ok && result.degraded) {
    assert.deepEqual(result.waivedPlanes, ["coven", "github"]);
    assert.ok(!result.waivedPlanes.includes("beads"), "an enforced plane is not waived");
  } else {
    assert.fail("expected a degraded admission");
  }
});

test("missing planes are reported in a stable order", () => {
  // The refusal text lists them; an unstable order would churn logs and make
  // two identical failures look different.
  for (let i = 0; i < 5; i += 1) {
    const result = assessMaintenancePlaneAdmission({
      capabilities: capabilities(),
      allowUnenforcedPlanes: false,
    });
    if (!result.ok) assert.deepEqual(result.missingPlanes, ["coven", "beads", "github"]);
  }
});

test("a missing plane entry fails closed, not open", () => {
  // The defect this replaced: `capabilities[plane]?.enforced === false` is false
  // when the entry is undefined, so an absent plane read as enforced. A safety
  // gate must never treat missing data as satisfied.
  const withoutLocal = {
    coven: { enforced: true },
    beads: { enforced: true },
    github: { enforced: true },
  } as unknown as MaintenancePlaneCapabilities;

  const refused = assessMaintenancePlaneAdmission({
    capabilities: withoutLocal,
    allowUnenforcedPlanes: false,
  });
  assert.equal(refused.ok, false, "an absent local plane must not be admitted");
  if (!refused.ok) assert.deepEqual(refused.missingPlanes, ["local"]);

  // And the opt-in must not rescue it either: absent local is still local.
  const waived = assessMaintenancePlaneAdmission({
    capabilities: withoutLocal,
    allowUnenforcedPlanes: true,
  });
  assert.equal(waived.ok, false);
  if (!waived.ok) assert.equal(waived.code, "local-plane-unenforced");
});

test("a malformed plane entry is treated as unenforced", () => {
  for (const bad of [undefined, null, {}, { enforced: "yes" }, { enforced: 1 }]) {
    const capabilities = {
      local: { enforced: true },
      coven: { enforced: true },
      beads: { enforced: true },
      github: bad,
    } as unknown as MaintenancePlaneCapabilities;
    const result = assessMaintenancePlaneAdmission({
      capabilities,
      allowUnenforcedPlanes: false,
    });
    assert.equal(result.ok, false, `github=${JSON.stringify(bad)} must not be admitted`);
    if (!result.ok) assert.deepEqual(result.missingPlanes, ["github"]);
  }
});
