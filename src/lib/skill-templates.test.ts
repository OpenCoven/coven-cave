import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeholderSpans } from "@/lib/prompt-placeholders";
import { SKILL_TEMPLATES, mergeSkillTemplates, skillTemplateById } from "@/lib/skill-templates";

describe("skill templates", () => {
  it("every built-in is a complete kind with Tab-fillable blanks", () => {
    const ids = new Set<string>();
    for (const template of SKILL_TEMPLATES) {
      assert.ok(template.id && !ids.has(template.id), `unique id: ${template.id}`);
      ids.add(template.id);
      assert.ok(template.name.trim(), `${template.id} has a name`);
      assert.ok(template.description.trim(), `${template.id} has a description`);
      assert.equal(template.source, "builtin");
      assert.ok(template.tags.length >= 1, `${template.id} prefills at least one tag`);
      // The gallery's whole point: bodies drop into the placeholder Tab flow.
      assert.ok(
        placeholderSpans(template.instructions).length >= 2,
        `${template.id} has at least two {{placeholder}} blanks`,
      );
      assert.match(template.instructions, /^## When to use/m, `${template.id} opens with the trigger section`);
    }
  });

  it("looks templates up by id against a provided list", () => {
    assert.equal(skillTemplateById(SKILL_TEMPLATES, "procedure")?.name, "Procedure");
    assert.equal(skillTemplateById(SKILL_TEMPLATES, "nope"), null);
    assert.equal(skillTemplateById(SKILL_TEMPLATES, null), null);
  });

  it("merges user > pack > built-in by id, ignoring later duplicates within a tier", () => {
    const builtin = SKILL_TEMPLATES.slice(0, 2);
    const pack = [
      { ...builtin[0], name: "Pack override", source: "pack:demo" as const },
      { ...builtin[0], name: "Pack duplicate", source: "pack:demo" as const },
    ];
    const user = [{ ...builtin[0], name: "User override", source: "user" as const }];
    const merged = mergeSkillTemplates(builtin, pack, user);
    assert.equal(merged.find((t) => t.id === builtin[0].id)?.name, "User override");
    assert.equal(merged.find((t) => t.id === builtin[1].id)?.name, builtin[1].name);
    assert.equal(merged.length, builtin.length, "merge never duplicates ids");
  });
});
