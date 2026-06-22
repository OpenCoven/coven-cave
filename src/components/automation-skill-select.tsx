"use client";

import { useEffect, useState } from "react";

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
  const scopes = [...new Set(skills.map((s) => s.familiar))];

  return (
    <select className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— none —</option>
      {value && !known && <option value={value}>{value}</option>}
      {scopes.map((scope) => (
        <optgroup key={scope} label={scope}>
          {skills
            .filter((s) => s.familiar === scope)
            .map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
