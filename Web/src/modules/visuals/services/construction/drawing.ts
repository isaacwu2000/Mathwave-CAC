type Point = [number, number, number];
/** Triangulates a simple 2D polygon, including concave outlines.
 * Rejects self-intersections and degenerate contours instead of drawing a misleading fill.
 */
export function polygonTriangles(vertices: Point[]): number[] {
  if (vertices.length < 3 || vertices.length > 100)
    throw new Error('Polygons need 3–100 vertices.');
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const size = Math.max(
    ...vertices.map((point) =>
      Math.hypot(point[0] - vertices[0][0], point[1] - vertices[0][1]),
    ),
  );
  const epsilon = Math.max(Number.MIN_VALUE, size * size * 1e-12);
  const onSegment = (a: Point, b: Point, c: Point) =>
    Math.abs(cross(a, b, c)) <= epsilon &&
    c[0] >= Math.min(a[0], b[0]) &&
    c[0] <= Math.max(a[0], b[0]) &&
    c[1] >= Math.min(a[1], b[1]) &&
    c[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length];
    for (let j = i + 2; j < vertices.length; j++) {
      if (i === 0 && j === vertices.length - 1) continue;
      const c = vertices[j],
        d = vertices[(j + 1) % vertices.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        throw new Error('Polygon edges must not cross or overlap.');
    }
  }
  const area = vertices.reduce(
    (sum, point, i) =>
      sum + cross(vertices[0], point, vertices[(i + 1) % vertices.length]),
    0,
  );
  if (Math.abs(area) <= epsilon)
    throw new Error('Polygon area must be nonzero.');
  const remaining = area > 0 ? [...vertices] : [...vertices].reverse();
  const triangles: number[] = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length],
        b = remaining[i],
        c = remaining[(i + 1) % remaining.length];
      if (Math.abs(cross(a, b, c)) <= epsilon) {
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
      if (cross(a, b, c) < 0) continue;
      if (
        remaining.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            cross(a, b, p) >= -epsilon &&
            cross(b, c, p) >= -epsilon &&
            cross(c, a, p) >= -epsilon,
        )
      )
        continue;
      triangles.push(...a, ...b, ...c);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped)
      throw new Error('Polygon could not be triangulated. Check its vertices.');
  }
  triangles.push(...remaining.flat());
  return triangles;
}
