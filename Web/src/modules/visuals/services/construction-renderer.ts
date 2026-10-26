import { drawingColors } from './drawing-colors.ts';
import { validateConstruction } from './construction.ts';
import { polygonTriangles } from './construction/drawing.ts';
import type { GeometryValue } from './construction/types.ts';
import type { GraphDocument, GraphResult, Plot } from '../types.ts';

/**
 * Draws fully checked constructions with equal coordinate scales.
 * Clips infinite lines and rays to the visible square; circles use bounded samples.
 * Invalid source produces no partial drawing and never changes saved work.
 */
export function constructionRenderData(
  source: string,
  compiled = validateConstruction(source),
) {
  const anchors: { x: number; y: number }[] = [];
  for (const value of compiled.objects) {
    if (value.kind === 'point') anchors.push(value);
    else if (value.kind === 'circle')
      anchors.push(
        { x: value.center.x - value.radius, y: value.center.y - value.radius },
        { x: value.center.x + value.radius, y: value.center.y + value.radius },
      );
    else if (value.kind === 'polygon') anchors.push(...value.vertices);
    else if ('a' in value) anchors.push(value.a, value.b);
  }
  for (const arc of compiled.arcs)
    anchors.push(
      { x: arc.x - arc.radius, y: arc.y - arc.radius },
      { x: arc.x + arc.radius, y: arc.y + arc.radius },
    );
  const xs = anchors.map((p) => p.x),
    ys = anchors.map((p) => p.y);
  const lowX = Math.min(...xs),
    highX = Math.max(...xs),
    lowY = Math.min(...ys),
    highY = Math.max(...ys);
  const span = Math.max(highX - lowX, highY - lowY, 1) * 1.4;
  const cx = (lowX + highX) / 2,
    cy = (lowY + highY) / 2;
  const bounds = {
    min: cx - span / 2,
    max: cx + span / 2,
    y: { min: cy - span / 2, max: cy + span / 2 },
  };
  const plots: Plot[] = [];
  const labels = [...compiled.labels];
  const xyz = (p: { x: number; y: number }) => [p.x, p.y, 0];
  const arc = (
    id: string,
    x: number,
    y: number,
    radius: number,
    start: number,
    end: number,
  ) => {
    const positions: number[] = [];
    const at = (t: number) => [
      x + radius * Math.cos(t),
      y + radius * Math.sin(t),
      0,
    ];
    for (let i = 1; i <= 128; i++)
      positions.push(
        ...at(start + ((end - start) * (i - 1)) / 128),
        ...at(start + ((end - start) * i) / 128),
      );
    plots.push({ id, kind: 'line', color: drawingColors.stroke, positions });
  };
  const draw = (value: GeometryValue, index: number) => {
    const id = `object-${index}`,
      color = drawingColors.stroke;
    if (value.kind === 'circle')
      return arc(
        id,
        value.center.x,
        value.center.y,
        value.radius,
        0,
        2 * Math.PI,
      );
    if (value.kind === 'point') {
      plots.push({ id, kind: 'point', color, positions: xyz(value) });
      return;
    }
    if (value.kind === 'polygon') {
      const vertices = value.vertices.map(
        (p) => xyz(p) as [number, number, number],
      );
      plots.push({
        id: `${id}-fill`,
        kind: 'surface',
        color: drawingColors.fill,
        opacity: 0.3,
        positions: polygonTriangles(vertices),
      });
      plots.push({
        id,
        kind: 'line',
        color,
        positions: vertices.flatMap((p, i) => [
          ...p,
          ...vertices[(i + 1) % vertices.length],
        ]),
      });
      return;
    }
    if (!('a' in value)) return;
    const { a, b } = value;
    if (value.kind === 'segment') {
      plots.push({
        id,
        kind: 'line',
        color,
        positions: [...xyz(a), ...xyz(b)],
      });
      return;
    }
    const dx = b.x - a.x,
      dy = b.y - a.y;
    let low = value.kind === 'ray' ? 0 : -Infinity,
      high = Infinity;
    for (const [start, direction, min, max] of [
      [a.x, dx, bounds.min, bounds.max],
      [a.y, dy, bounds.y.min, bounds.y.max],
    ]) {
      if (direction === 0) {
        if (start < min || start > max) return;
      } else {
        const t1 = (min - start) / direction,
          t2 = (max - start) / direction;
        low = Math.max(low, Math.min(t1, t2));
        high = Math.min(high, Math.max(t1, t2));
      }
    }
    if (low <= high)
      plots.push({
        id,
        kind: 'line',
        color,
        positions: [
          a.x + low * dx,
          a.y + low * dy,
          0,
          a.x + high * dx,
          a.y + high * dy,
          0,
        ],
      });
  };
  compiled.objects.forEach(draw);
  compiled.arcs.forEach((a, i) =>
    arc(`angle-${i}`, a.x, a.y, a.radius, a.start, a.end),
  );
  const document: GraphDocument = {
    dimension: 2,
    expressions: [],
    angleMode: 'radians',
    construction: source,
    presentation: { preset: 'geometry' },
    bounds,
  };
  const result: GraphResult = {
    plots,
    labels,
    errors: {},
    values: {},
    parameters: [],
  };
  return { document, result };
}
