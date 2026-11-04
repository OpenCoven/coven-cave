import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAutomationsDomain } from "./automations-domain.ts";

test("the automations domain is enabled unless the setting explicitly turns it off", () => {
  for (const setting of [undefined, "", "   ", "1", "true", "on", "enabled", "yes"]) {
    assert.deepEqual(resolveAutomationsDomain(setting), { enabled: true, reason: "enabled" }, String(setting));
  }
  for (const setting of ["0", "false", "off", " OFF ", "False"]) {
    assert.deepEqual(resolveAutomationsDomain(setting), { enabled: false, reason: "disabled" }, setting);
  }
});
