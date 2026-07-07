// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./user-avatar-migrate.ts", import.meta.url), "utf8");

assert.match(source, /let attempted = false/, "migration is guarded to one attempt per page load");
assert.match(source, /Promise\.all\(\[whenUserProfileHydrated\(\), whenUserAvatarHydrated\(\)\]\)/, "migration waits for both profile and legacy avatar stores");
assert.match(source, /server\.avatar\.present/, "migration skips when the server already has an avatar");
assert.match(source, /legacy\.mime === "image\/svg\+xml"/, "migration skips legacy SVG images rejected by the server avatar endpoint");
assert.match(source, /uploadUserProfileAvatar\(\{ dataUrl: legacy\.dataUrl, mime: legacy\.mime \}\)/, "migration uploads legacy bytes to the server avatar endpoint");
assert.match(source, /if \(res\.ok\) await clearUserAvatarImage\(\)/, "migration only clears legacy storage after a successful server upload");

console.log("user-avatar-migrate.test.ts: ok");
