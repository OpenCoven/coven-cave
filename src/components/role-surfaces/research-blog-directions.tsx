"use client";

import { useId, useRef, useState } from "react";
import { Popover } from "@/components/ui/popover";
import { useAnnouncer } from "@/components/ui/live-region";
import type { BlogDirections } from "@/lib/research-blog-directions";
import "@/styles/research-blog-directions.css";

const FIELDS = [
  { key: "visual", label: "Visual direction", presets: ["Editorial illustration", "Photography", "Diagrams", "Minimal", "No visuals"] },
  { key: "tone", label: "Tone", presets: ["Clear", "Technical", "Conversational", "Warm", "Analytical", "Playful"] },
  { key: "audience", label: "Audience", presets: ["General readers", "Developers", "Researchers", "Designers", "Product teams", "Business leaders"] },
] as const;

function DirectionSelect({ label, presets, value, onChange }: {
  label: string;
  presets: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { announce } = useAnnouncer();
  const options = [...new Set([...presets, ...value])];
  const custom = query.trim();
  const matching = options.filter((option) => option.toLowerCase().includes(custom.toLowerCase()));
  const canAdd = custom.length > 0 && !options.some((option) => option.toLowerCase() === custom.toLowerCase());
  const toggle = (option: string) => {
    const selected = value.includes(option);
    onChange(selected ? value.filter((item) => item !== option) : [...value, option]);
    announce(`${label}: ${option} ${selected ? "removed" : "selected"}.`);
  };
  const add = () => {
    if (!canAdd) return;
    toggle(custom);
    setQuery("");
  };
  return (
    <div className="research-studio-config__field">
      <label className="research-studio-config__label" htmlFor={id}>{label} (optional)</label>
      <button id={id} type="button" ref={anchorRef} className="research-studio__select focus-ring"
        aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setOpen(!open); setQuery(""); }}>
        {value.length ? value.join(", ") : `Choose ${label.toLowerCase()}…`}
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} ariaLabel={label}>
        <div className="research-blog-directions__options" role="group" aria-label={`${label} choices`}>
          <label htmlFor={`${id}-search`}>Search or add {label.toLowerCase()}</label>
          <input id={`${id}-search`} className="research-studio-config__input focus-ring"
            aria-label={`Search ${label.toLowerCase()}`} value={query} maxLength={120}
            placeholder={`Search ${label.toLowerCase()}…`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
          {matching.map((option) => (
            <label key={option} className="research-blog-directions__option">
              <input type="checkbox" className="focus-ring" aria-label={option}
                checked={value.includes(option)} onChange={() => toggle(option)} />
              <span>{option}</span>
            </label>
          ))}
          {canAdd ? <button type="button" className="research-studio-act focus-ring" aria-label={`Add ${custom}`} onClick={add}>Add “{custom}”</button> : null}
          {!matching.length && !canAdd ? <p role="status">No matches. Enter a custom choice.</p> : null}
        </div>
      </Popover>
    </div>
  );
}

export function BlogDirectionControls({ value, onChange }: { value: BlogDirections; onChange: (value: BlogDirections) => void }) {
  return <div className="research-blog-directions">
    {FIELDS.map(({ key, label, presets }) => <DirectionSelect key={key} label={label} presets={presets}
      value={value[key]} onChange={(choices) => onChange({ ...value, [key]: choices })} />)}
  </div>;
}
