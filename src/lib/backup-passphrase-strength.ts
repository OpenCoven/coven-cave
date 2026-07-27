export function getBackupPassphraseStrength(passphrase: string) {
  let score = 0;
  if (passphrase.length >= 8) score += 1;
  if (passphrase.length >= 14) score += 1;
  if (/[0-9]/.test(passphrase) && /[a-z]/i.test(passphrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) score += 1;
  if (passphrase) score = Math.max(1, score);

  const labels = [
    "Passphrase required",
    "Weak passphrase",
    "Fair passphrase",
    "Good passphrase",
    "Strong passphrase",
  ] as const;

  return { score, label: labels[score] ?? labels[4] };
}
