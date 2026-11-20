// Pure geometry helpers used by the loop/trail system. No Phaser imports so they
// can be unit-tested in isolation.

export interface Vec {
  x: number;
  y: number;
}

/** Intersection point of segments AB and CD, or null. Touching endpoints count. */
export function segmentIntersection(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const rX = b.x - a.x;
  const rY = b.y - a.y;
  const sX = d.x - c.x;
  const sY = d.y - c.y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null; // parallel or degenerate
  const qpX = c.x - a.x;
  const qpY = c.y - a.y;
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rX, y: a.y + t * rY };
}

/** Even-odd ray casting point-in-polygon test. */
export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Absolute polygon area via the shoelace formula. */
export function polygonArea(poly: readonly Vec[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(sum / 2);
}

export function polygonPerimeter(poly: readonly Vec[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += Math.hypot(poly[i].x - poly[j].x, poly[i].y - poly[j].y);
  }
  return sum;
}

/** Isoperimetric quotient: 1 for a circle, near 0 for a thin sliver. */
export function compactness(poly: readonly Vec[], area = polygonArea(poly)): number {
  const p = polygonPerimeter(poly);
  return p > 0 ? (4 * Math.PI * area) / (p * p) : 0;
}

const MIN_COMPACTNESS = 0.12;

export function polygonCentroid(poly: readonly Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** Squared distance from point P to segment AB. */
export function distSqPointSegment(p: Vec, a: Vec, b: Vec): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const len = abX * abX + abY * abY;
  let t = len > 0 ? ((p.x - a.x) * abX + (p.y - a.y) * abY) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a.x + t * abX - p.x;
  const dy = a.y + t * abY - p.y;
  return dx * dx + dy * dy;
}

export interface LoopResult {
  polygon: Vec[];
  /** Index of the older segment that was crossed. */
  crossedIndex: number;
  point: Vec;
  area: number;
}

/**
 * Checks whether the newest segment of `points` (last two points) crosses any
 * older, non-adjacent segment. Returns the largest resulting closed loop.
 */
export function findLoop(points: readonly Vec[], minArea: number, snapDist = 0): LoopResult | null {
  const n = points.length;
  if (n < 4) return null;
  const a = points[n - 2];
  const b = points[n - 1];
  // Oldest crossing first => largest loop.
  for (let i = 0; i < n - 3; i++) {
    const hit = segmentIntersection(a, b, points[i], points[i + 1]);
    if (!hit) continue;
    const polygon: Vec[] = [hit];
    for (let k = i + 1; k <= n - 2; k++) polygon.push(points[k]);
    if (polygon.length < 3) continue;
    const area = polygonArea(polygon);
    if (area < minArea || compactness(polygon, area) < MIN_COMPACTNESS) continue;
    return { polygon, crossedIndex: i, point: hit, area };
  }
  // Forgiving closure: the head returned close to an older part of the trail
  // without quite crossing it (e.g. retracing a circle).
  if (snapDist > 0) {
    const s2 = snapDist * snapDist;
    for (let i = 0; i < n - 8; i++) {
      const p = points[i];
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      if (dx * dx + dy * dy > s2) continue;
      const polygon = points.slice(i, n);
      const area = polygonArea(polygon);
      if (area < minArea || compactness(polygon, area) < MIN_COMPACTNESS) continue;
      return { polygon, crossedIndex: i, point: { x: b.x, y: b.y }, area };
    }
  }
  return null;
}
