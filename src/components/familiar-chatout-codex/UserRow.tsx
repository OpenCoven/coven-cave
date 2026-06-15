import styles from "./styles.module.css";

export function UserRow({ text }: { text: string }) {
  return (
    <div className={styles.userRow}>
      <div className={styles.userBubble}>{text}</div>
    </div>
  );
}
