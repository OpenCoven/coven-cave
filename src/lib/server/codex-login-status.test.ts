import assert from "node:assert/strict";
import { test } from "node:test";
import { codexNeedsLogin } from "./codex-login-status.ts";

test("only a confirmed signed-out login status enables recovery", async () => {
  for (const [status, exit, expected] of [
    ["Not logged in", 1, true],
    ["Logged in using ChatGPT", 0, false],
    ["Not logged in", 0, false],
    ["Unknown command", 1, false],
  ] as const) {
    const script = `if (process.argv.slice(1).join(" ") !== "login status") process.exit(2);
      console.error(${JSON.stringify(status)}); process.exit(${exit});`;
    assert.equal(await codexNeedsLogin({ command: process.execPath, fixedArgs: ["-e", script] }, process.env), expected);
  }
});
