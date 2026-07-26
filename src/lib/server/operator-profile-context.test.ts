import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOperatorProfileContext } from "./familiar-startup-context.ts";

describe("buildOperatorProfileContext", () => {
  it("returns null for empty profiles", () => {
    assert.equal(buildOperatorProfileContext(undefined), null);
    assert.equal(buildOperatorProfileContext({}), null);
  });
  it("renders only the set fields", () => {
    const ctx = buildOperatorProfileContext({ name: "Buns", timezone: "America/Chicago" });
    assert.ok(ctx);
    assert.equal(ctx.relativePath, "operator-profile");
    assert.match(ctx.contents, /Name: Buns/);
    assert.match(ctx.contents, /Timezone: America\/Chicago/);
    assert.doesNotMatch(ctx.contents, /Pronouns|Bio|Links/);
  });
  it("renders links as label — url lines", () => {
    const ctx = buildOperatorProfileContext({ links: [{ label: "GitHub", url: "https://github.com/x" }] });
    assert.match(ctx!.contents, /GitHub — https:\/\/github\.com\/x/);
  });
});
