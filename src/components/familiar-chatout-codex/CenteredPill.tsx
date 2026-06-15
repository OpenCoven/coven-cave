import styles from "./styles.module.css";

export function CenteredPill({ text }: { text: string }) {
  return (
    <div className={styles.pillRow}>
      <div className={styles.centeredPill}>{text}</div>
    </div>
  );
}
