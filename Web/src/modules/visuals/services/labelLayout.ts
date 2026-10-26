type Label = { text: string; x: number; y: number; scientific?: boolean };
type Segment = { a: { x: number; y: number }; b: { x: number; y: number } };

/** Places mathematical labels outward from their diagram, avoiding already placed labels.
 * Screen-space placement runs only when the camera or graph changes, never in the math worker.
 */
export function layoutGraphLabels<T extends Label>(
  labels: readonly T[],
  width: number,
  height: number,
  segments: readonly Segment[] = [],
): T[] {
  if (!labels.length) return [];
  const center = {
    x: labels.reduce((sum, p) => sum + p.x, 0) / labels.length,
    y: labels.reduce((sum, p) => sum + p.y, 0) / labels.length,
  };
  const placed: T[] = [];
  for (const label of labels) {
    const labelWidth = Math.max(
      16,
      label.text.length * (label.scientific ? 12 : 8),
    );
    let best = { x: label.x, y: label.y, score: Infinity };
    // Try nearby positions first. Overlapping another label is worse than
    // crossing a stroke; distance and outward placement only break ties.
    for (const radius of label.scientific ? [42, 62, 82] : [18, 38, 58])
      for (let direction = 0; direction < 8; direction++) {
        const angle = (direction * Math.PI) / 4,
          dx = Math.cos(angle),
          dy = Math.sin(angle);
        const x = Math.max(
          2,
          Math.min(
            width - labelWidth - 6,
            label.x + radius * dx - labelWidth / 2,
          ),
        );
        const y = Math.max(
          2,
          Math.min(height - 22, label.y + radius * dy - 10),
        );
        const collisions = placed.filter(
          (p) =>
            x <
              p.x + Math.max(16, p.text.length * (p.scientific ? 12 : 8)) + 4 &&
            x + labelWidth + 4 > p.x &&
            y < p.y + 24 &&
            y + 24 > p.y,
        ).length;
        const strokes = segments.some(({ a, b }) => {
          // A circle enclosing the label conservatively approximates
          // its distance to the nearest point on a finite stroke.
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((x + labelWidth / 2 - a.x) * dx + (y + 10 - a.y) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          );
          return (
            Math.hypot(
              x + labelWidth / 2 - a.x - t * dx,
              y + 10 - a.y - t * dy,
            ) <
            Math.hypot(labelWidth / 2, 10) + 3
          );
        });
        const outward =
          ((label.x - center.x) * dx + (label.y - center.y) * dy) /
          Math.max(1, Math.hypot(label.x - center.x, label.y - center.y));
        const score =
          collisions * 10000 + Number(strokes) * 1000 + radius - outward * 8;
        if (score < best.score) best = { x, y, score };
      }
    placed.push({ ...label, x: best.x, y: best.y });
  }
  return placed;
}

/** Selects readable DNA base pairs without moving letters away from their rungs.
 * Both letters are kept or omitted together. Terminal labels remain unchanged.
 * The semantic sequence is preserved; explicit show-all bypasses this selection.
 */
export function separatedBasePairLabels<
  T extends Label & { sequenceIndex?: number },
>(
  labels: readonly T[],
  size: (label: T) => { width: number; height: number },
): T[] {
  const kept = new Set<number>();
  const occupied: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }[] = [];
  const overlap = (
    a: (typeof occupied)[number],
    b: (typeof occupied)[number],
  ) =>
    a.left < b.right + 8 &&
    a.right + 8 > b.left &&
    a.top < b.bottom + 8 &&
    a.bottom + 8 > b.top;
  for (const index of new Set(
    labels.flatMap((l) =>
      l.sequenceIndex === undefined ? [] : [l.sequenceIndex],
    ),
  )) {
    const pair = labels.filter((l) => l.sequenceIndex === index);
    if (pair.length !== 2) continue;
    const boxes = pair.map((l) => {
      const { width, height } = size(l);
      return {
        left: l.x - width / 2,
        right: l.x + width / 2,
        top: l.y - height / 2,
        bottom: l.y + height / 2,
      };
    });
    if (
      overlap(boxes[0], boxes[1]) ||
      boxes.some((box) => occupied.some((other) => overlap(box, other)))
    )
      continue;
    kept.add(index);
    occupied.push(...boxes);
  }
  return labels.filter(
    (l) => l.sequenceIndex === undefined || kept.has(l.sequenceIndex),
  );
}
