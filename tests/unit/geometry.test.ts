import { describe, expect, it } from 'vitest';
import { distSqPointSegment, findLoop, pointInPolygon, polygonArea, segmentIntersection } from '../../src/game/geometry';

describe('geometry', () => {
  it('finds segment intersections', () => {
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 5 });
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 6, y: 1 })).toBeNull();
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
  });

  it('tests points in concave polygons', () => {
    const u = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    expect(pointInPolygon({ x: 5, y: 20 }, u)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 20 }, u)).toBe(false);
    expect(pointInPolygon({ x: 40, y: 5 }, u)).toBe(false);
  });

  it('computes area', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(100);
  });

  it('distance to segment', () => {
    expect(distSqPointSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
    expect(distSqPointSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(25);
  });

  it('detects an alpha-shaped crossing', () => {
    const trail = [
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 160, y: 60 },
      { x: 100, y: 120 },
      { x: 40, y: 60 },
      { x: 60, y: 30 },
      { x: 120, y: -20 },
    ];
    let loop = null;
    for (let n = 2; n <= trail.length && !loop; n++) loop = findLoop(trail.slice(0, n), 500);
    expect(loop).not.toBeNull();
    expect(pointInPolygon({ x: 100, y: 60 }, loop!.polygon)).toBe(true);
  });

  it('snaps a near-miss retraced circle closed', () => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 36) * Math.PI * 2; // a bit more than one turn
      pts.push({ x: 100 + Math.cos(t) * 50 + i * 0.3, y: 100 + Math.sin(t) * 50 });
    }
    let loop = null;
    const trail = [];
    for (const p of pts) {
      trail.push(p);
      loop = findLoop(trail, 500, 15);
      if (loop) break;
    }
    expect(loop).not.toBeNull();
    expect(pointInPolygon({ x: 105, y: 100 }, loop!.polygon)).toBe(true);
    expect(pointInPolygon({ x: 300, y: 100 }, loop!.polygon)).toBe(false);
    expect(loop!.area).toBeGreaterThan(6000);
  });

  it('ignores tiny jitter loops', () => {
    const trail = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 2, y: -2 },
    ];
    expect(findLoop(trail, 500)).toBeNull();
  });

  it('a straight or doubled-back trail never loops', () => {
    const trail = Array.from({ length: 50 }, (_, i) => ({ x: i * 8, y: Math.sin(i) * 2 }));
    for (let n = 4; n <= trail.length; n++) expect(findLoop(trail.slice(0, n), 100, 15)).toBeNull();
    // swimming straight back along the same line encloses no area
    const back = [...trail, ...trail.slice().reverse().map((p) => ({ x: p.x, y: p.y + 6 }))];
    for (let n = 4; n <= back.length; n++) expect(findLoop(back.slice(0, n), 1700, 15)).toBeNull();
  });
});
