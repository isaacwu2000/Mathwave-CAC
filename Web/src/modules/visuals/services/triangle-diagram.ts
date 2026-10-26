import {
  validateGeometry,
  geometryMeasures,
  type Geometry,
} from './geometry.ts';
export type TriangleOverlay =
  | 'centroid'
  | 'median a'
  | 'median b'
  | 'median c'
  | 'inradius'
  | 'circumradius'
  | 'altitude a'
  | 'altitude b'
  | 'altitude c';
export function validateTriangleOverlay(
  value: unknown,
): asserts value is TriangleOverlay {
  if (
    typeof value !== 'string' ||
    !/^(centroid|inradius|circumradius|altitude [abc]|median [abc])$/.test(
      value,
    )
  )
    throw new Error('Invalid triangle overlay.');
}
type Point = { x: number; y: number };
export function triangleDiagram(g: Geometry, overlay?: TriangleOverlay) {
  validateGeometry(g);
  if (
    !['triangle', 'right triangle'].includes(g.shape) ||
    'base' in g.dimensions
  )
    return null;
  const d = g.dimensions,
    right = g.shape === 'right triangle';
  const base = right ? d.b : d.c;
  const cx = right ? 0 : (d.b ** 2 + base ** 2 - d.a ** 2) / (2 * base);
  const height = right ? d.a : Math.sqrt(Math.max(0, d.b ** 2 - cx ** 2));
  if (!(height > 0)) return null;
  const vertices: Point[] = [
    { x: 0, y: 0 },
    { x: base, y: 0 },
    { x: cx, y: height },
  ];
  const metrics = geometryMeasures(g);
  const centroid = {
    x: vertices.reduce((sum, p) => sum + p.x, 0) / 3,
    y: vertices.reduce((sum, p) => sum + p.y, 0) / 3,
  };
  const medians = ['a', 'b', 'c']
    .map((side, named) => {
      const opposite = right ? [1, 2, 0][named] : named;
      const p = vertices[(opposite + 1) % 3],
        q = vertices[(opposite + 2) % 3];
      return {
        side,
        start: vertices[opposite],
        midpoint: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
      };
    })
    .filter((m) => overlay === 'centroid' || overlay === `median ${m.side}`);

  let circle: { center: Point; radius: number } | undefined;
  let altitude:
    | {
        start: Point;
        foot: Point;
        sideStart: Point;
        sideEnd: Point;
        outside: boolean;
      }
    | undefined;
  if (overlay === 'inradius') {
    const sides = right ? [Math.hypot(d.a, d.b), d.a, d.b] : [d.a, d.b, d.c];
    const perimeter = sides.reduce((sum, side) => sum + side, 0);
    circle = {
      center: {
        x: vertices.reduce((sum, p, i) => sum + p.x * sides[i], 0) / perimeter,
        y: vertices.reduce((sum, p, i) => sum + p.y * sides[i], 0) / perimeter,
      },
      radius: metrics.inradius.value,
    };
  } else if (overlay === 'circumradius') {
    circle = {
      center: {
        x: base / 2,
        y: (cx * cx + height * height - base * cx) / (2 * height),
      },
      radius: metrics.circumradius.value,
    };
  } else if (overlay?.startsWith('altitude')) {
    const named = ['a', 'b', 'c'].indexOf(overlay.slice(-1));
    const opposite = right ? [1, 2, 0][named] : named;
    const start = vertices[opposite],
      sideStart = vertices[(opposite + 1) % 3],
      sideEnd = vertices[(opposite + 2) % 3];
    const dx = sideEnd.x - sideStart.x,
      dy = sideEnd.y - sideStart.y;
    const t =
      ((start.x - sideStart.x) * dx + (start.y - sideStart.y) * dy) /
      (dx * dx + dy * dy);
    altitude = {
      start,
      sideStart,
      sideEnd,
      foot: { x: sideStart.x + t * dx, y: sideStart.y + t * dy },
      outside: t < -1e-12 || t > 1 + 1e-12,
    };
  }
  const bounds = [
    ...vertices,
    ...(altitude ? [altitude.foot] : []),
    ...(circle
      ? [
          {
            x: circle.center.x - circle.radius,
            y: circle.center.y - circle.radius,
          },
          {
            x: circle.center.x + circle.radius,
            y: circle.center.y + circle.radius,
          },
        ]
      : []),
  ];
  const minX = Math.min(...bounds.map((p) => p.x)),
    maxX = Math.max(...bounds.map((p) => p.x));
  const minY = Math.min(...bounds.map((p) => p.y)),
    maxY = Math.max(...bounds.map((p) => p.y));
  const scale = Math.min(340 / (maxX - minX), 155 / (maxY - minY));
  const project = (p: Point) => ({
    x: 300 + (p.x - (minX + maxX) / 2) * scale,
    y: 120 - (p.y - (minY + maxY) / 2) * scale,
  });
  return {
    vertices,
    medians,
    centroid: overlay === 'centroid' ? centroid : undefined,
    circle,
    altitude,
    project,
    scale,
    value: overlay ? metrics[overlay]?.value : undefined,
  };
}
