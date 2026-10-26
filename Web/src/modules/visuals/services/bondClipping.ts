type Point = { x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number };

/** Removes portions of a screen-space bond covered by label hit boxes.
 * Preserves direction and exact box-edge endpoints; fully covered bonds disappear.
 * Source geometry remains unchanged, so zoom and pan can recompute the clipping.
 */
export function clipBondToLabels(
  a: Point,
  b: Point,
  boxes: readonly Box[],
): { a: Point; b: Point }[] {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let visible: [number, number][] = [[0, 1]];
  for (const box of boxes) {
    let enter = 0,
      exit = 1;
    for (const [origin, delta, min, max] of [
      [a.x, dx, box.left, box.right],
      [a.y, dy, box.top, box.bottom],
    ]) {
      if (Math.abs(delta) < 1e-10) {
        if (origin < min || origin > max) {
          enter = 1;
          exit = 0;
          break;
        }
      } else {
        const t1 = (min - origin) / delta,
          t2 = (max - origin) / delta;
        enter = Math.max(enter, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
      }
    }
    if (exit <= enter) continue;
    visible = visible.flatMap(([start, end]) => {
      if (exit <= start || enter >= end)
        return [[start, end] as [number, number]];
      const parts: [number, number][] = [];
      if (enter > start) parts.push([start, enter]);
      if (exit < end) parts.push([exit, end]);
      return parts;
    });
  }
  const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
  return visible
    .filter(([start, end]) => end - start > 1e-8)
    .map(([start, end]) => ({ a: at(start), b: at(end) }));
}

/** Subtracts label rectangles from a filled convex bond, then returns triangles.
 * Clipping applies to the entire area, including wide wedges whose corners lie
 * outside a label. Source vertices and label rectangles are never mutated.
 */
export function clipBondPolygonToLabels(
  vertices: readonly Point[],
  boxes: readonly Box[],
): [Point, Point, Point][] {
  let pieces: Point[][] = [[...vertices]];
  for (const box of boxes) {
    const outside: Point[][] = [];
    for (const piece of pieces) {
      let remaining = piece;
      // Each box edge splits off a visible piece. Only the part inside
      // all four edges is covered by the label and discarded.
      for (const [axis, edge, sign] of [
        ['x', box.left, 1],
        ['x', box.right, -1],
        ['y', box.top, 1],
        ['y', box.bottom, -1],
      ] as const) {
        const inside: Point[] = [],
          visible: Point[] = [];
        for (let i = 0; i < remaining.length; i++) {
          const a = remaining[i],
            b = remaining[(i + 1) % remaining.length];
          const da = (a[axis] - edge) * sign,
            db = (b[axis] - edge) * sign;
          (da >= 0 ? inside : visible).push(a);
          if (da >= 0 !== db >= 0) {
            const t = da / (da - db),
              cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            inside.push(cut);
            visible.push(cut);
          }
        }
        if (visible.length >= 3) outside.push(visible);
        remaining = inside;
        if (remaining.length < 3) break;
      }
    }
    pieces = outside;
  }
  const triangles: [Point, Point, Point][] = [];
  for (const piece of pieces)
    for (let i = 1; i + 1 < piece.length; i++) {
      const [a, b, c] = [piece[0], piece[i], piece[i + 1]];
      if (
        Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-8
      )
        triangles.push([a, b, c]);
    }
  return triangles;
}
