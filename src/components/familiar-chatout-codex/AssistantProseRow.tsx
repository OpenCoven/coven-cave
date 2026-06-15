import styles from "./styles.module.css";

type Props = {
  text: string;
  tone?: "normal" | "muted";
};

export function AssistantProseRow({ text, tone = "normal" }: Props) {
  const toneClass = tone === "muted" ? styles.assistantRowMuted : styles.assistantRowNormal;
  return <p className={`${styles.assistantRow} ${toneClass}`}>{text}</p>;
}
