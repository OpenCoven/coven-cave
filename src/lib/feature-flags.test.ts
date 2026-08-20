import assert from "node:assert/strict";
import { caveAgenticRecommendations } from "./feature-flags.ts";

const original = process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS;

try {
  delete process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS;
  assert.equal(caveAgenticRecommendations(), false, "agentic recommendations default off");

  for (const enabled of ["1", "true", "yes", "on", " ON "]) {
    process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS = enabled;
    assert.equal(caveAgenticRecommendations(), true, `${enabled} enables agentic recommendations`);
  }

  for (const disabled of ["0", "false", "no", "off", "enabled"]) {
    process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS = disabled;
    assert.equal(caveAgenticRecommendations(), false, `${disabled} does not enable agentic recommendations`);
  }
} finally {
  if (original === undefined) delete process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS;
  else process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS = original;
}

console.log("feature-flags.test.ts: ok");
