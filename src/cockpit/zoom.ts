// src/cockpit/zoom.ts — the arithmetic of the picture viewer's pinch and double tap: pure, so a
// test can state it without a touch screen.

/** A picture is never smaller than its own fit, and never more than this many times it. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
/** What a double tap zooms in to. */
export const DOUBLE_TAP_SCALE = 2.5;

export interface Point {
  x: number;
  y: number;
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The scale two fingers ask for: the scale when they went down, times how far apart they are now over then. */
export function pinchScale(startScale: number, startDistance: number, nowDistance: number): number {
  if (startDistance <= 0) return startScale;
  return clampScale((startScale * nowDistance) / startDistance);
}

/** The most a picture at `scale` may be dragged from the middle along a side `extent` px long: its overhang. */
export function panLimit(scale: number, extent: number): number {
  return (extent * (scale - 1)) / 2;
}

export function clampPan(value: number, scale: number, extent: number): number {
  const limit = panLimit(scale, extent);
  return Math.min(limit, Math.max(-limit, value));
}
