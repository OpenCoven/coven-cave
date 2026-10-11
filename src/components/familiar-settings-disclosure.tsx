"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import "@/styles/familiar-settings-navigation.css";

/** Mount optional editors on first intent; collapsing keeps their draft intact. */
export function FamiliarSettingsDisclosure({ title, description, reveal = false, children }: {
  title: string;
  description: string;
  reveal?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(reveal);
  const [visited, setVisited] = useState(reveal);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (reveal) { setVisited(true); setOpen(true); }
  }, [reveal]);
  return (
    <section className="familiar-settings-disclosure" onKeyDown={event => {
      if (event.key !== "Escape" || event.defaultPrevented || !open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} type="button" className="familiar-settings-disclosure__trigger focus-ring-inset"
        aria-expanded={open} aria-controls={id} aria-label={title}
        onClick={() => { setVisited(true); setOpen(value => !value); }}>
        <span><span className="familiar-settings-disclosure__title">{title}</span><span className="familiar-settings-disclosure__description">{description}</span></span>
        <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={16} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="familiar-settings-disclosure__body">
        {visited ? children : null}
      </div>
    </section>
  );
}
