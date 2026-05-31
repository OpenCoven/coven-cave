"use client";

import type { ReactNode } from "react";
import { Modal } from "./modal";
import { Icon, type IconName } from "@/lib/icon";

export type ChooserOption = {
  id: string;
  icon: IconName;
  title: string;
  description: ReactNode;
};

type ChooserModalProps = {
  open: boolean;
  onClose: () => void;
  breadcrumb: ReactNode[];
  options: ChooserOption[];
  onPick: (id: string) => void;
};

/**
 * Three-option chooser modal — the "how do you want to do X?" pattern.
 * Stacked large list buttons; each shows icon + title + description.
 */
export function ChooserModal({ open, onClose, breadcrumb, options, onPick }: ChooserModalProps) {
  return (
    <Modal open={open} onClose={onClose} breadcrumb={breadcrumb}>
      <div className="ui-chooser-list">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className="ui-chooser-option"
            onClick={() => {
              onPick(opt.id);
              onClose();
            }}
          >
            <span className="ui-chooser-option-icon">
              <Icon name={opt.icon} width={20} />
            </span>
            <span className="ui-chooser-option-body">
              <span className="ui-chooser-option-title">{opt.title}</span>
              <span className="ui-chooser-option-subtitle">{opt.description}</span>
            </span>
            <span className="ui-chooser-option-chevron" aria-hidden>
              <Icon name="ph:caret-right" width={14} />
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
