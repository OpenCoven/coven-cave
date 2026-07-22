// @ts-nocheck
import assert from "node:assert/strict";
import { openCodeCommand, openCodeLaunch, openCodeNeedsTmpRuntimeDir } from "./opencode-bin.ts";

assert.equal(openCodeCommand(), "opencode", "OpenCode uses the same executable name on all desktop platforms");

const linuxLaunch = openCodeLaunch(["run", "--format", "json", "safe & literal"], "linux");
assert.deepEqual(linuxLaunch, {
  command: "opencode",
  args: ["run", "--format", "json", "safe & literal"],
}, "POSIX launches OpenCode directly");
const windowsLaunch = openCodeLaunch(["run", "safe & literal", "percent%PATH%"], "win32", { SystemRoot: "C:\\Windows" });
assert.equal(windowsLaunch.command, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
assert.ok(windowsLaunch.args.includes("-NoProfile"), "Windows launch does not load profile aliases");
assert.equal(windowsLaunch.input, JSON.stringify(["run", "safe & literal", "percent%PATH%"]), "Windows launch preserves untrusted argv as JSON data");
assert.match(windowsLaunch.args.at(-1) ?? "", /\[Console\]::In\.ReadToEnd\(\)/, "Windows launch reads argv from stdin instead of a shell command");
const longPrompt = "x".repeat(40_000);
const longWindowsLaunch = openCodeLaunch(["run", longPrompt], "win32", { SystemRoot: "C:\\Windows" });
assert.equal(longWindowsLaunch.input, JSON.stringify(["run", longPrompt]), "Windows preserves a long prompt outside the command line");
assert.ok(!longWindowsLaunch.args.join(" ").includes(longPrompt), "Windows command line stays bounded for long prompts");

assert.equal(openCodeNeedsTmpRuntimeDir("win32", {}), false, "Windows does not use XDG_RUNTIME_DIR");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", {}), true, "headless Linux receives OpenCode's /tmp fallback");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }), false, "native Linux preserves a valid runtime directory");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", { WSL_DISTRO_NAME: "Ubuntu", XDG_RUNTIME_DIR: "/run/user/1000" }), true, "WSL replaces a stale inherited runtime directory");
assert.equal(openCodeNeedsTmpRuntimeDir("darwin", {}), true, "headless macOS receives OpenCode's /tmp fallback");
assert.equal(openCodeNeedsTmpRuntimeDir("darwin", { XDG_RUNTIME_DIR: "/var/folders/runtime" }), false, "native macOS preserves a valid runtime directory");

console.log("opencode-bin.test.ts: ok");
