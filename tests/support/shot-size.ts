// mw-s6387p.1: the size `npm run shots` is shooting right now (scripts/run-shots.mjs sets SHOT_SIZE
// to 390x844, 360x640 or 1280x800 for each of its runs), or null outside it.
export type Viewport = { width: number; height: number };

export function shotSize(env: Record<string, string | undefined> = process.env): Viewport | null {
  const match = /^(\d+)x(\d+)$/.exec(env.SHOT_SIZE ?? '');
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}
