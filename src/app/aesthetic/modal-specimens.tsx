"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal, type ModalPresentation, type ModalSize } from "@/components/ui/modal";
import { TextInput } from "@/components/ui/text-input";

type Specimen = { label: string; size: ModalSize; presentation: ModalPresentation };
const SPECIMENS: Specimen[] = [
  { label: "Compact confirmation", size: "compact", presentation: "dialog" },
  { label: "Standard dialog", size: "standard", presentation: "dialog" },
  { label: "Wide dialog", size: "wide", presentation: "dialog" },
  { label: "Reader dialog", size: "reader", presentation: "dialog" },
  { label: "Workspace dialog", size: "workspace", presentation: "dialog" },
  { label: "Left sheet", size: "standard", presentation: "sheet-left" },
  { label: "Right sheet", size: "standard", presentation: "sheet-right" },
  { label: "Fullscreen", size: "reader", presentation: "fullscreen" },
];

/** Live design reference: these all render the production Modal foundation. */
export function ModalSpecimens() {
  const [selected, setSelected] = useState<Specimen | null>(null);
  const [busy, setBusy] = useState(false);
  const [nested, setNested] = useState(false);
  const [longContent, setLongContent] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const close = () => { setNested(false); setSelected(null); };
  return (
    <div className="aesthetic-modal-specimens">
      <p>Shared sizes, chrome, actions, focus, and responsive presentation. Open a variant to inspect it in the current theme.</p>
      <label className="aesthetic-modal-option"><input type="checkbox" checked={longContent} onChange={(event) => setLongContent(event.target.checked)} />Long content</label>
      <div className="aesthetic-modal-options">
        {SPECIMENS.map((specimen) => <Button key={specimen.label} onClick={() => { setBusy(false); setSelected(specimen); }}>{specimen.label}</Button>)}
      </div>
      <Modal
        open={selected !== null}
        onClose={close}
        title={selected?.label}
        description="One consistent frame for decisions, forms, readers, and panels."
        size={selected?.size}
        presentation={selected?.presentation}
        busy={busy}
        initialFocusRef={cancelRef}
        footerPills={<span>Preview only</span>}
        footerActions={<><Button ref={cancelRef} disabled={busy} onClick={close}>Cancel</Button><Button variant="primary" onClick={() => setBusy(!busy)}>{busy ? "Finish pending action" : "Preview pending action"}</Button></>}
      >
        <div className="aesthetic-modal-content">
          <Field label="Project name" description="Labels stay visible when a value is entered."><TextInput placeholder="e.g., Coven Cave" /></Field>
          <Button onClick={() => setNested(true)}>Open nested dialog</Button>
          {longContent ? Array.from({ length: 32 }, (_, index) => <p key={index}>Section {index + 1}. Long content scrolls within the body while the title and actions remain available. Long project names and translated actions should wrap without hiding the decision.</p>) : <p>Use Tab and Shift+Tab to move between controls. Closing returns focus to the button that opened this preview.</p>}
          <Modal open={nested} onClose={() => setNested(false)} title="Nested dialog" size="compact" footerActions={<Button onClick={() => setNested(false)}>Back to preview</Button>}>
            <p>Escape closes this layer first, then returns focus to the parent dialog.</p>
          </Modal>
        </div>
      </Modal>
    </div>
  );
}
