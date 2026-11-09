export function needsVerifiedMfaEmail(user: { email?: string; email_confirmed_at?: string } | null) {
  return !user?.email?.trim() || !user.email_confirmed_at;
}
