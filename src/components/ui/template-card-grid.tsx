"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

export type TemplateCard = {
  id: string;
  icon: IconName;
  title: ReactNode;
  description: ReactNode;
};

type TemplateCardGridProps = {
  templates: TemplateCard[];
  onPick?: (id: string) => void;
  /** 2-column (default) or 3-column at wider widths. */
  columns?: 2 | 3;
  /** Optional headline + subtitle rendered above the grid. */
  headline?: ReactNode;
  subtitle?: ReactNode;
  /** Optional "+ Start from scratch" affordance below the grid. */
  startFromScratchLabel?: string;
  onStartFromScratch?: () => void;
};

export function TemplateCardGrid({
  templates,
  onPick,
  columns = 2,
  headline,
  subtitle,
  startFromScratchLabel,
  onStartFromScratch,
}: TemplateCardGridProps) {
  return (
    <div className="flex flex-col items-center gap-6">
      {headline ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="text-[18px] font-semibold text-foreground">{headline}</h2>
          {subtitle ? <p className="text-[13px] text-muted-foreground">{subtitle}</p> : null}
        </div>
      ) : null}

      <div className={`ui-template-grid w-full${columns === 3 ? " ui-template-grid--3" : ""}`}>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className="ui-template-card"
            onClick={onPick ? () => onPick(t.id) : undefined}
          >
            <span className="ui-template-card-icon">
              <Icon name={t.icon} width={16} />
            </span>
            <span className="ui-template-card-title">{t.title}</span>
            <span className="ui-template-card-subtitle">{t.description}</span>
          </button>
        ))}
      </div>

      {startFromScratchLabel && onStartFromScratch ? (
        <button
          type="button"
          onClick={onStartFromScratch}
          className="ui-pill"
        >
          <Icon name="ph:plus" width={12} />
          <span>{startFromScratchLabel}</span>
        </button>
      ) : null}
    </div>
  );
}
