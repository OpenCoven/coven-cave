import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SECTIONS, SETTINGS_INDEX } from "./settings-sections.ts";

const panel = readFileSync(
  fileURLToPath(new URL("./settings-profile.tsx", import.meta.url)),
  "utf8",
);
const shell = readFileSync(
  fileURLToPath(new URL("./settings-shell.tsx", import.meta.url)),
  "utf8",
);

describe("Settings → Profile", () => {
  it("registers first in the section catalog", () => {
    assert.equal(SECTIONS[0]?.id, "profile");
    assert.equal(SECTIONS[0]?.icon, "ph:user-circle");
  });

  it("is searchable (name, pronouns, timezone, avatar, links)", () => {
    const entries = SETTINGS_INDEX.filter((e) => e.section === "profile");
    const keywords = entries.map((e) => e.keywords).join(" ");
    for (const term of ["name", "pronouns", "timezone", "avatar", "bio", "links"]) {
      assert.match(keywords, new RegExp(term));
    }
    assert.ok(entries.some((e) => e.group === "Links" && /\blinks\b/.test(e.keywords)));
  });

  it("shell renders the panel for the profile section", () => {
    assert.match(shell, /section === "profile"\s*&&\s*<ProfileSection \/>/);
  });

  it("saves text fields on blur through the shared store and announces outcomes", () => {
    assert.match(panel, /saveUserProfile/);
    assert.match(panel, /onBlur/);
    assert.match(panel, /useAnnouncer/);
  });

  it("uploads through the shared image prepare pipeline and the server store", () => {
    assert.match(panel, /<SettingsGroup label="Image"/);
    assert.match(panel, /prepareFamiliarImage/);
    assert.match(panel, /uploadUserProfileAvatar/);
    assert.match(panel, /removeUserProfileAvatar/);
  });

  it("keeps the legacy SVG hint without importing the retired avatar store", () => {
    assert.match(panel, /hasLegacySvgUserAvatar/);
    assert.doesNotMatch(panel, /avatar-image|AvatarHydrated|AvatarImageSnapshot/);
  });

  it("timezone options come from Intl with a system default", () => {
    assert.match(panel, /supportedValuesOf\("timeZone"\)/);
    assert.match(panel, /resolvedOptions\(\)\.timeZone/);
  });
});
