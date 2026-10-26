import type { Circle2, GeometryValue, Line2, Point2 } from './types.ts';

const point = (x: number, y: number): Point2 => ({ kind: 'point', x, y });
const cross = (ax: number, ay: number, bx: number, by: number) =>
  ax * by - ay * bx;

/** Computes finite intersections with scale-relative degeneracy checks.
 * Coincident objects are ambiguous; two finite points have explicit lexicographic order.
 */
export function intersections(
  a: Line2 | Circle2,
  b: Line2 | Circle2,
): Point2[] {
  let points: Point2[];
  if (a.kind === 'line' && b.kind === 'line') {
    const ax = a.b.x - a.a.x,
      ay = a.b.y - a.a.y,
      bx = b.b.x - b.a.x,
      by = b.b.y - b.a.y;
    const determinant = cross(ax, ay, bx, by);
    if (
      Math.abs(determinant) <=
      1e-12 * Math.hypot(ax, ay) * Math.hypot(bx, by)
    ) {
      if (onObject(b.a, a))
        throw new Error('Coincident lines have infinitely many intersections.');
      return [];
    }
    const t = cross(b.a.x - a.a.x, b.a.y - a.a.y, bx, by) / determinant;
    points = [point(a.a.x + t * ax, a.a.y + t * ay)];
  } else if (a.kind === 'circle' && b.kind === 'circle') {
    const dx = b.center.x - a.center.x,
      dy = b.center.y - a.center.y,
      d = Math.hypot(dx, dy);
    const tolerance = 1e-12 * Math.max(d, a.radius, b.radius);
    if (d <= tolerance) {
      if (Math.abs(a.radius - b.radius) <= tolerance)
        throw new Error(
          'Coincident circles have infinitely many intersections.',
        );
      return [];
    }
    if (
      d > a.radius + b.radius + tolerance ||
      d < Math.abs(a.radius - b.radius) - tolerance
    )
      return [];
    // h² is a squared length. Near tangency, collapse roundoff-sized h²
    // to one point using a length tolerance multiplied by a radius.
    const t = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
    const h2 = a.radius * a.radius - t * t;
    const x = a.center.x + (t * dx) / d,
      y = a.center.y + (t * dy) / d;
    if (Math.abs(h2) <= tolerance * Math.max(a.radius, b.radius))
      return [point(x, y)];
    if (h2 < 0) return [];
    const h = Math.sqrt(h2);
    points = [
      point(x - (h * dy) / d, y + (h * dx) / d),
      point(x + (h * dy) / d, y - (h * dx) / d),
    ];
  } else {
    const line = a.kind === 'line' ? a : b.kind === 'line' ? b : null;
    const circle = a.kind === 'circle' ? a : b.kind === 'circle' ? b : null;
    if (!line || !circle) throw new Error('Expected a line and circle.');
    const dx = line.b.x - line.a.x,
      dy = line.b.y - line.a.y,
      length = Math.hypot(dx, dy);
    const ux = dx / length,
      uy = dy / length;
    // Project onto a unit direction before checking the radial gap, so the
    // tangency tolerance is measured in lengths rather than squared lengths.
    const t =
      (circle.center.x - line.a.x) * ux + (circle.center.y - line.a.y) * uy;
    const x = line.a.x + t * ux,
      y = line.a.y + t * uy;
    const offset = Math.hypot(x - circle.center.x, y - circle.center.y);
    const tolerance = 1e-12 * Math.max(offset, circle.radius);
    if (offset > circle.radius + tolerance) return [];
    if (Math.abs(offset - circle.radius) <= tolerance) return [point(x, y)];
    const h = Math.sqrt(circle.radius * circle.radius - offset * offset);
    points = [point(x - h * ux, y - h * uy), point(x + h * ux, y + h * uy)];
  }
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Intersection is outside finite numeric precision.');
  return points.sort((p, q) => p.x - q.x || p.y - q.y);
}

/** Checks incidence using a tolerance relative to the object's own length scale. */
export function onObject(
  p: Point2,
  object: Exclude<
    GeometryValue,
    { kind: 'point' | 'scalar' | 'boolean' | 'polygon' }
  >,
): boolean {
  if (object.kind === 'circle')
    return (
      Math.abs(
        Math.hypot(p.x - object.center.x, p.y - object.center.y) -
          object.radius,
      ) <=
      1e-9 * object.radius
    );
  const dx = object.b.x - object.a.x,
    dy = object.b.y - object.a.y,
    length = Math.hypot(dx, dy);
  const px = p.x - object.a.x,
    py = p.y - object.a.y,
    scale = Math.max(length, Math.hypot(px, py));
  if (!Number.isFinite(scale))
    throw new Error('Incidence exceeds finite numeric precision.');
  // Unit directions keep products bounded even for very large coordinates.
  if (Math.abs(cross(px / scale, py / scale, dx / length, dy / length)) > 1e-9)
    return false;
  const t = (px / length) * (dx / length) + (py / length) * (dy / length);
  if (!Number.isFinite(t))
    throw new Error('Incidence exceeds finite numeric precision.');
  return (
    object.kind === 'line' ||
    (t >= -1e-9 && (object.kind === 'ray' || t <= 1 + 1e-9))
  );
}
