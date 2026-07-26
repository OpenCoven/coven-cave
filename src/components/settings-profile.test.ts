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
    for (const term of ["name", "pronouns", "timezone", "avatar", "bio", "personality", "mbti", "links"]) {
      assert.match(keywords, new RegExp(term));
    }
    assert.ok(entries.some((e) => e.group === "Links" && /\blinks\b/.test(e.keywords)));
  });

  it("gives every Profile search target a stable settings-group anchor", () => {
    const groups = [
      ...new Set(
        SETTINGS_INDEX
          .filter((entry) => entry.section === "profile")
          .map((entry) => entry.group)
          .filter((group): group is string => Boolean(group)),
      ),
    ];
    assert.deepEqual(groups, ["Identity", "Context", "Personality", "Links"]);
    for (const group of groups) {
      assert.ok(panel.includes(`id={settingsGroupId("${group}")}`), `${group} has a search anchor`);
    }
  });

  it("shell renders the panel for the profile section", () => {
    assert.match(shell, /section === "profile"\s*&&\s*<ProfileSection \/>/);
  });

  it("uses a reviewable Save changes / Discard workflow and announces outcomes", () => {
    assert.match(panel, /saveUserProfile/);
    assert.match(panel, /Save changes/);
    assert.match(panel, /Discard/);
    assert.match(panel, /metaKey|ctrlKey/);
    assert.match(panel, /⌘S save/);
    assert.doesNotMatch(panel, /Esc back/);
    assert.match(panel, /useAnnouncer/);
  });

  it("keeps the saved form snapshot aligned with persisted nonblank links", () => {
    assert.match(panel, /compactProfileLinkDrafts/);
    assert.match(panel, /links:\s*compactProfileLinkDrafts\(next\.links\)/);
    assert.match(panel, /setSavedForm\(cloneForm\(persistedForm\)\)/);
  });

  it("keeps oversized structured names out of the capped legacy name field", () => {
    assert.match(panel, /legacyProfileName/);
    assert.match(panel, /name:\s*legacyProfileName\(displayName\(form\)\)/);
  });

  it("uploads through the shared image prepare pipeline and the server store", () => {
    assert.match(panel, /prepareFamiliarImage/);
    assert.match(panel, /uploadUserProfileAvatar/);
    assert.match(panel, /removeUserProfileAvatar/);
    assert.match(panel, /className="settings-profile__portrait reveal-scope"/);
    assert.match(panel, /className="settings-profile__portrait-actions reveal-on-hover"/);
  });

  it("keeps the legacy SVG hint without importing the retired avatar store", () => {
    assert.match(panel, /hasLegacySvgUserAvatar/);
    assert.doesNotMatch(panel, /avatar-image|AvatarHydrated|AvatarImageSnapshot/);
  });

  it("timezone options come from Intl with a system default", () => {
    assert.match(panel, /supportedValuesOf\("timeZone"\)/);
    assert.match(panel, /resolvedOptions\(\)\.timeZone/);
    assert.match(panel, /Familiars receive this timezone in your profile context\./);
    assert.doesNotMatch(panel, /Schedules and digests follow this clock/);
  });

  it("routes external destinations through Cave's Browser surface", () => {
    assert.match(panel, /openExternalUrl/);
    assert.match(panel, /openExternalUrl\("https:\/\/www\.16personalities\.com\/free-personality-test"\)/);
    assert.match(panel, /openExternalUrl\(stored\.url\)/);
    assert.doesNotMatch(panel, /target="_blank"|window\.open\(/);
  });

  it("implements the imported control-sheet sections and preview", () => {
    assert.match(panel, /SETTINGS · PROFILE/);
    assert.match(panel, /Profile completion/);
    assert.match(panel, /IDENTITY/);
    assert.match(panel, /CONTEXT/);
    assert.match(panel, /PERSONALITY/);
    assert.match(panel, /LINKS/);
    assert.match(panel, /Show profile card|Hide profile card/);
    assert.match(panel, /First name/);
    assert.match(panel, /Nickname/);
    assert.match(panel, /Fine-tune axes/);
    assert.match(panel, /16personalities\.com\/free-personality-test/);
  });

  it("keeps field labels visible and connects custom-link errors to their input", () => {
    for (const label of ["First name", "Last name", "Nickname", "Link label", "Link URL"]) {
      assert.match(panel, new RegExp(`className="settings-profile__input-label">${label}`));
    }
    assert.match(
      panel,
      /aria-describedby=\{invalid \? `\$\{baseId\}-link-\$\{link\.id\}-url-error` : undefined\}/,
    );
    assert.match(panel, /id=\{`\$\{baseId\}-link-\$\{link\.id\}-url-error`\}/);
    assert.match(panel, /Enter a complete http\(s\) URL\./);
    assert.doesNotMatch(panel, /placeholder="First"|placeholder="Last"|placeholder="https:\/\/"/);
  });

  it("keeps the imported hero-name rename interaction", () => {
    assert.match(panel, /title="Double-click to rename"/);
    assert.match(panel, /onDoubleClick=\{\(\) => setEditingName\(true\)\}/);
    assert.match(panel, /aria-label="Display name"/);
    assert.match(panel, /nameEditRef\.current\?\.select\(\)/);
  });

  it("allows exact percentage entry for tuned personality axes", () => {
    assert.match(panel, /title="Double-click to set exactly"/);
    assert.match(panel, /type="number"/);
    assert.match(panel, /Math\.max\(0, Math\.min\(100,/);
    assert.match(panel, /percentEditRef\.current\?\.select\(\)/);
    assert.match(panel, /className="settings-profile__type-percent-input focus-ring-inset"/);
  });

  it("drafts a bio through the selected familiar with an undo path", () => {
    assert.match(panel, /streamFamiliarText/);
    assert.match(panel, /permissionMode:\s*"read"/);
    assert.match(panel, /Draft with/);
    assert.match(panel, /Undo/);
  });

  it("surfaces familiar loading failures with an explicit retry", () => {
    assert.match(panel, /familiarLoadState/);
    assert.match(panel, /familiarLoadNonce/);
    assert.match(panel, /<ErrorState[\s\S]*headline="Couldn’t load familiars"/);
    assert.match(panel, /setFamiliarLoadNonce\(\(nonce\) => nonce \+ 1\)/);
    assert.match(panel, />\s*Retry\s*</);
    assert.doesNotMatch(panel, /\.catch\(\(\) => \{\}\)/);
  });

  it("uses a dedicated tokenized stylesheet for responsive profile layout", () => {
    assert.match(panel, /@\/styles\/settings-profile\.css/);
    assert.match(panel, /className="settings-profile__link-row reveal-scope"/);
    assert.match(panel, /className="settings-profile__link-actions reveal-on-hover"/);
  });
});
