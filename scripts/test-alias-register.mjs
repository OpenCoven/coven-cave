// Registers the `@/` path-alias resolve hook for the test runner.
// Used via `node --experimental-strip-types --import ./scripts/test-alias-register.mjs <test>`.
import { register } from "node:module";

register("./test-alias-loader.mjs", import.meta.url);
