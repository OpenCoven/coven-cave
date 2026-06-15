import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { SubagentData } from "./mockInspector";
import styles from "./styles.module.css";

type Props = {
  subagents: SubagentData[];
};

const STATUS_CLASS: Record<SubagentData["status"], string> = {
  active: styles.statusDotActive,
  done: styles.statusDotDone,
  idle: styles.statusDotIdle,
};

export function SubagentsList({ subagents }: Props) {
  return (
    <section className={styles.inspectorSection}>
      <h2 className={styles.sectionHeader}>Subagents</h2>
      <div className={styles.subagentRows}>
        {subagents.map((subagent) => (
          <div className={styles.subagentRow} key={subagent.id}>
            <FamiliarAvatar familiar={subagent.familiar} size="md" className={styles.avatar} title={subagent.name} />
            <span>{subagent.name}</span>
            <span
              className={`${styles.statusDot} ${STATUS_CLASS[subagent.status]}`}
              aria-label={`${subagent.name} ${subagent.status}`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
