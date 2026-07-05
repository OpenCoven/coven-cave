"use client";

import { useEffect, useState } from "react";
import type { StandardSelectGroup, StandardSelectOption } from "@/components/ui/select";
import { StandardSelect } from "@/components/ui/select";

type LocalSkill = { id: string; name: string; path: string; familiar: string };

type Props = {
  value: string | null;
  onChange: (path: string | null) => void;
  className?: string;
};

/** Picks a local skill (sets skill_path to its directory). Source: /api/skills/local. */
export function SkillSelect({ value, onChange, className }: Props) {
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/skills/local", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.skills)) setSkills(j.skills);
      })
      .catch(() => {
        /* offline → just the none option */
      });
    return () => {
      alive = false;
    };
  }, []);

  const known = skills.some((s) => s.path === value);
  const groupedSkills: (StandardSelectGroup<string> | StandardSelectOption<string>)[] = [
    { value: "", label: "— none —" },
    ...(value && !known ? [{ value, label: value }] : []),
    ...[...new Set(skills.map((s) => s.familiar))].map((scope) => ({
      label: scope,
      options: skills
        .filter((s) => s.familiar === scope)
        .map((s) => ({ value: s.path, label: s.name })),
    })),
  ];

  return (
    <StandardSelect
      label="Skill"
      className={className}
      value={value ?? ""}
      onChange={(next) => onChange(next || null)}
      options={groupedSkills}
      placeholder="— none —"
    />
  );
}
