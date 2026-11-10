/** Match the weekly limit indicator's five-day warning window. */
export function resetExpiringSoon(expiresAt: string | undefined | null, now: number) {
  const expiresIn = expiresAt ? Date.parse(expiresAt) - now : null;
  return expiresIn !== null && expiresIn >= 0 && expiresIn <= 120 * 60 * 60_000;
}
