export function getBackupPassphraseGuidance(passphrase: string) {
  const length = passphrase.length;
  const score =
    length === 0 ? 0 :
    length < 8 ? 1 :
    length < 14 ? 2 :
    length < 20 ? 3 :
    4;

  const labels = [
    "Passphrase required",
    "Use at least 8 characters",
    "Minimum length met",
    "14+ characters",
    "20+ characters",
  ] as const;

  return { score, label: labels[score] ?? labels[4] };
}
