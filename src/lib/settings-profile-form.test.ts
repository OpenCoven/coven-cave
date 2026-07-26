import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as profileFormHelpers from "./settings-profile-form.ts";
import {
  buildProfileBioPrompt,
  mbtiAdaptation,
  mbtiCode,
  profileCompletion,
  profileLinkDraft,
  profileLinkValue,
  seedPersonalityAxes,
} from "./settings-profile-form.ts";

describe("Settings Profile form helpers", () => {
  it("seeds and derives MBTI axes using the imported control-sheet model", () => {
    assert.deepEqual(seedPersonalityAxes("INTJ"), { ei: 75, sn: 25, tf: 25, jp: 25 });
    assert.equal(
      mbtiCode({ type: "INTJ", tuned: true, axes: { ei: 20, sn: 80, tf: 70, jp: 55 } }),
      "ESFP",
    );
    assert.match(mbtiAdaptation("INTJ"), /keep openers brief/);
    assert.match(mbtiAdaptation("INTJ"), /close with a decision/);
  });

  it("round-trips known social links while preserving custom URLs", () => {
    const github = profileLinkDraft({ label: "GitHub", url: "https://github.com/BunsDev" }, "1");
    assert.deepEqual(github, {
      id: "1",
      site: "github",
      user: "BunsDev",
      label: "",
      url: "",
    });
    assert.deepEqual(profileLinkValue(github), {
      label: "GitHub",
      url: "https://github.com/BunsDev",
    });

    const custom = profileLinkDraft({ label: "Work", url: "https://example.com/about" }, "2");
    assert.equal(custom.site, "custom");
    assert.deepEqual(profileLinkValue(custom), {
      label: "Work",
      url: "https://example.com/about",
    });
  });

  it("preserves a custom label when a URL matches a known social site", () => {
    const original = {
      label: "Work samples",
      url: "https://github.com/BunsDev",
    };

    assert.deepEqual(profileLinkValue(profileLinkDraft(original, "3")), original);
  });

  it("drops blank link rows from the saved draft snapshot", () => {
    const compactProfileLinkDrafts = (
      profileFormHelpers as Record<string, unknown>
    ).compactProfileLinkDrafts;
    assert.equal(typeof compactProfileLinkDrafts, "function");
    const compact = compactProfileLinkDrafts as (
      drafts: Array<ReturnType<typeof profileLinkDraft>>,
    ) => Array<ReturnType<typeof profileLinkDraft>>;
    const github = profileLinkDraft(
      { label: "GitHub", url: "https://github.com/BunsDev" },
      "1",
    );

    assert.deepEqual(
      compact([
        github,
        { id: "2", site: "github", user: "", label: "", url: "" },
        { id: "3", site: "custom", user: "", label: "", url: "" },
      ]),
      [github],
    );
  });

  it("only mirrors display names that fit the legacy name field", () => {
    const legacyProfileName = (
      profileFormHelpers as Record<string, unknown>
    ).legacyProfileName;
    assert.equal(typeof legacyProfileName, "function");
    const legacyName = legacyProfileName as (value: string) => string | null;

    assert.equal(legacyName("Val"), "Val");
    assert.equal(legacyName("x".repeat(65)), null);
  });

  it("counts the five completion channels", () => {
    assert.deepEqual(
      profileCompletion({
        displayName: "Val",
        pronouns: "she / her",
        avatar: true,
        bio: "",
        links: 2,
      }),
      { filled: 4, total: 5, percent: 80 },
    );
  });

  it("builds a bounded third-person bio prompt from current form context", () => {
    const prompt = buildProfileBioPrompt({
      familiarName: "Sage",
      firstName: "Valentina",
      lastName: "Alexander",
      nickname: "Val",
      pronouns: "she / her",
      timezone: "America/Chicago",
      personality: {
        type: "INTJ",
        tuned: false,
        axes: { ei: 75, sn: 25, tf: 25, jp: 25 },
      },
      links: [{ label: "GitHub", url: "https://github.com/BunsDev" }],
    });
    assert.match(prompt, /You are Sage/);
    assert.match(prompt, /under 240 characters/);
    assert.match(prompt, /Name: Valentina Alexander/);
    assert.match(prompt, /Nickname: Val/);
    assert.match(prompt, /MBTI: INTJ/);
    assert.match(prompt, /Return only the bio text/);
  });
});
