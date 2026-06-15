import styles from "./styles.module.css";

export function RunTimeChip({ label }: { label: string }) {
  return (
    <div className={styles.runtimeRow}>
      <span className={styles.runTimeChip} aria-label={label}>
        <span aria-hidden>◷</span>
        <span>{label}</span>
      </span>
    </div>
  );
}
