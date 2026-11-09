export function referralCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z0-9]{6,64}$/.test(code) ? code : null;
}
