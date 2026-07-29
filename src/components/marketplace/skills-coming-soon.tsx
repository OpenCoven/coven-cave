"use client";

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/lib/icon";

const CURATION_STEPS: ReadonlyArray<{
  icon: IconName;
  title: string;
  detail: string;
}> = [
  {
    icon: "ph:book-open",
    title: "Review the source",
    detail: "Ownership, provenance, and maintenance are clear.",
  },
  {
    icon: "ph:flask",
    title: "Verify the behavior",
    detail: "Instructions are tested in Cave before they are listed.",
  },
  {
    icon: "ph:seal-check",
    title: "Publish for familiars",
    detail: "The reviewed skill becomes ready to discover.",
  },
];

export function SkillsComingSoon({
  onViewOwnedSkills,
  onBuildSkill,
}: {
  onViewOwnedSkills: () => void;
  onBuildSkill: () => void;
}) {
  return (
    <div
      role="tabpanel"
      id="marketplace-panel-skills"
      aria-labelledby="marketplace-tab-skills"
      className="marketplace-coming-soon"
    >
      <section className="marketplace-coming-soon__stage" aria-labelledby="marketplace-coming-soon-heading">
        <div className="marketplace-coming-soon__copy">
          <p className="marketplace-coming-soon__eyebrow">
            OpenCoven Skills <span>Coming soon</span>
          </p>
          <h2 id="marketplace-coming-soon-heading">Skills worth summoning.</h2>
          <p>
            A smaller, reviewed skills marketplace is taking shape. The first shelf
            stays empty until the work earns a place here.
          </p>
        </div>

        <ol className="marketplace-coming-soon__shelf" aria-label="Skills publication path">
          {CURATION_STEPS.map((step, index) => (
            <li className="marketplace-coming-soon__slot" key={step.title}>
              <span className="marketplace-coming-soon__number" aria-hidden>
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon name={step.icon} width={18} aria-hidden />
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>

        <div className="marketplace-coming-soon__actions">
          <Button variant="secondary" size="sm" leadingIcon="ph:sparkle" onClick={onViewOwnedSkills}>
            View your skills
          </Button>
          <Button variant="primary" size="sm" leadingIcon="ph:hammer" onClick={onBuildSkill}>
            Build a skill
          </Button>
        </div>
      </section>
    </div>
  );
}
