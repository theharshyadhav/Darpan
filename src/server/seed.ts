/** Demo Mode keeps a rescan near the first scan by seeding from a random per-device id. */
export function visitorSeed(raw: string | null): string {
  const s = (raw ?? "").trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : "guest";
}
