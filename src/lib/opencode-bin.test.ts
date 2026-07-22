// @ts-nocheck
import assert from "node:assert/strict";
import { openCodeCommand, openCodeNeedsTmpRuntimeDir } from "./opencode-bin.ts";

assert.equal(openCodeCommand(), "opencode", "OpenCode uses the same executable name on all desktop platforms");

assert.equal(openCodeNeedsTmpRuntimeDir("win32", {}), false, "Windows does not use XDG_RUNTIME_DIR");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", {}), true, "headless Linux receives OpenCode's /tmp fallback");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }), false, "native Linux preserves a valid runtime directory");
assert.equal(openCodeNeedsTmpRuntimeDir("linux", { WSL_DISTRO_NAME: "Ubuntu", XDG_RUNTIME_DIR: "/run/user/1000" }), true, "WSL replaces a stale inherited runtime directory");
assert.equal(openCodeNeedsTmpRuntimeDir("darwin", {}), true, "headless macOS receives OpenCode's /tmp fallback");
assert.equal(openCodeNeedsTmpRuntimeDir("darwin", { XDG_RUNTIME_DIR: "/var/folders/runtime" }), false, "native macOS preserves a valid runtime directory");

console.log("opencode-bin.test.ts: ok");
