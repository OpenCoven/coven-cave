"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, usePopoverInitialFocus } from "@/components/ui/popover";
import { WorkspaceContextSwitcher, type WorkspaceContextSwitcherProps } from "@/components/workspace-context-switcher";
import "@/styles/chat-browse-filter.css";

/** Optional browse controls. None of these callbacks change the chat actor. */
export function ChatBrowseFilter(props: WorkspaceContextSwitcherProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  usePopoverInitialFocus(open, ".chat-browse-filter__panel");
  const filtered = props.projectId !== null || props.selectedFamiliarIds.size > 0;
  const familiarLabel = props.selectedFamiliarIds.size === 1
    ? props.allFamiliars.find((familiar) => props.selectedFamiliarIds.has(familiar.id))?.display_name
    : props.selectedFamiliarIds.size > 1 ? `${props.selectedFamiliarIds.size} familiars` : null;
  const label = [props.project?.name ?? (props.projectId ? "Project unavailable" : null), familiarLabel].filter(Boolean).join(" · ") || "All chats";
  return (
    <>
      <Button ref={anchorRef} size="sm" variant="ghost" className="chat-browse-filter__trigger" leadingIcon="ph:funnel-fill" trailingIcon="ph:caret-down" aria-label={`Filter chats: ${label}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
      </Button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} placement="bottom-start" ariaLabel="Filter chats" className="chat-browse-filter__panel">
        <div className="chat-browse-filter__heading">Filter chats <span>Optional</span></div>
        <WorkspaceContextSwitcher {...props} variant="rail" fullAccessOnly />
        {props.projectId ? <p className="chat-browse-filter__help">Familiar choices have Full access. Historical chats remain available through All chats.</p> : null}
        {filtered ? <Button size="sm" variant="ghost" onClick={() => { props.onProjectChange(null); props.onSelectFamiliar(null); }}>Clear filters</Button> : null}
      </Popover>
    </>
  );
}
