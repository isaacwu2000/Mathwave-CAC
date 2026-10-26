import { drawingColors } from './drawing-colors.ts';
import { validateGeometry, type Geometry } from './geometry.ts';
import { triangleDiagram, type TriangleOverlay } from './triangle-diagram.ts';
import { displayNumber } from '../../math/index.ts';
import type { GraphDocument, GraphResult, Plot } from '../types.ts';

type Point = { x: number; y: number };
const vertex = (p: Point) => [p.x, p.y, 0];

/**
 * - Converts validated dimensions and selected overlays into drawing inputs.
 * - Uses Math Audio's triangle construction calculations and keeps equal axis scales.
 * - Draws solids as flat illustrations; this does not add 3D commands or save work.
 */
export function geometryRenderData(
  geometry: Geometry,
  overlay?: TriangleOverlay,
) {
  const g = validateGeometry(geometry),
    d = g.dimensions;
  const triangle = triangleDiagram(g, overlay);
  const exactLengths =
    !!triangle ||
    [
      'circle',
      'annulus',
      'sector',
      'regular polygon',
      'square',
      'rectangle',
    ].includes(g.shape);
  const plots: Plot[] = [],
    labels: NonNullable<GraphResult['labels']> = [];
  const line = (
    id: string,
    points: Point[],
    color = drawingColors.stroke,
    closed = false,
  ) => {
    const positions: number[] = [];
    const path = closed ? [...points, points[0]] : points;
    for (let i = 1; i < path.length; i++)
      positions.push(...vertex(path[i - 1]), ...vertex(path[i]));
    plots.push({ id, kind: 'line', color, positions });
    if (exactLengths && points.length === 2) labelLength(points[0], points[1]);
  };
  const fill = (
    id: string,
    points: Point[],
    color = drawingColors.fill,
    opacity = 0.3,
  ) => {
    const positions: number[] = [];
    for (let i = 1; i + 1 < points.length; i++)
      positions.push(
        ...vertex(points[0]),
        ...vertex(points[i]),
        ...vertex(points[i + 1]),
      );
    plots.push({ id, kind: 'surface', color, opacity, positions });
  };
  const polygon = (points: Point[]) => {
    line('outline', points, undefined, true);
    fill('fill', points);
    if (exactLengths)
      points.forEach((a, i) => labelLength(a, points[(i + 1) % points.length]));
  };
  const arc = (center: Point, rx: number, ry = rx, angle = 2 * Math.PI) =>
    Array.from({ length: 129 }, (_, i) => {
      const t = (angle * i) / 128;
      return { x: center.x + rx * Math.cos(t), y: center.y + ry * Math.sin(t) };
    });
  const label = (text: string, p: Point) =>
    labels.push({ text, position: [p.x, p.y, 0] });
  const labelLength = (a: Point, b: Point) =>
    label(displayNumber(Math.hypot(b.x - a.x, b.y - a.y)), {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
  if (triangle) {
    polygon(triangle.vertices);
    if (g.shape === 'right triangle') {
      const mark = Math.min(d.a, d.b) * 0.08;
      line(
        'right-angle',
        [
          { x: 0, y: mark },
          { x: mark, y: mark },
          { x: mark, y: 0 },
        ],
        drawingColors.detail,
      );
    }
    triangle.vertices.forEach((p, i) => label(['A', 'B', 'C'][i], p));
    for (const median of triangle.medians)
      line(
        `median-${median.side}`,
        [median.start, median.midpoint],
        drawingColors.detail,
      );
    if (triangle.medians.length && triangle.centroid) {
      plots.push({
        id: 'centroid',
        kind: 'point',
        color: drawingColors.detail,
        positions: vertex(triangle.centroid),
      });
      label('Centroid', triangle.centroid);
    }
    if (triangle.circle) {
      const { center, radius } = triangle.circle;
      line('overlay-circle', arc(center, radius), drawingColors.detail);
      line(
        'radius',
        [center, { x: center.x + radius, y: center.y }],
        drawingColors.detail,
      );
      label(`${overlay}: ${displayNumber(radius)}`, center);
    }
    if (triangle.altitude) {
      const a = triangle.altitude;
      line('altitude', [a.start, a.foot], drawingColors.detail);
      if (a.outside)
        line(
          'extended-side',
          [a.sideStart, a.foot, a.sideEnd],
          drawingColors.muted,
        );
      label(`${overlay}: ${displayNumber(triangle.value!)}`, a.foot);
    }
  } else if (g.shape === 'triangle') {
    polygon([
      { x: 0, y: 0 },
      { x: d.base, y: 0 },
      { x: d.base / 2, y: d.height },
    ]);
    line(
      'height',
      [
        { x: d.base / 2, y: 0 },
        { x: d.base / 2, y: d.height },
      ],
      drawingColors.detail,
    );
  } else if (['circle', 'annulus', 'sector'].includes(g.shape)) {
    const r = d.radius ?? d.outer,
      center = { x: 0, y: 0 };
    const points = arc(
      center,
      r,
      r,
      g.shape === 'sector' ? (d.angle * Math.PI) / 180 : undefined,
    );
    if (g.shape === 'annulus') {
      const inner = arc(center, d.inner);
      line('outer-circle', points);
      line('inner-circle', inner);
      for (let i = 1; i < points.length; i++) {
        fill(`ring-a-${i}`, [points[i - 1], points[i], inner[i]]);
        fill(`ring-b-${i}`, [points[i - 1], inner[i], inner[i - 1]]);
      }
    } else {
      line('outline', points);
      fill('fill', [center, ...points]);
      if (g.shape === 'sector') {
        line('radii', [points[0], center, points.at(-1)!]);
        line('chord', [points[0], points.at(-1)!], drawingColors.detail);
        fill('segment', points, drawingColors.detail, 0.15);
      } else line('radius', [center, { x: r, y: 0 }], drawingColors.detail);
    }
  } else if (g.shape === 'regular polygon') {
    const radius = d.side / (2 * Math.sin(Math.PI / d.sides));
    polygon(
      Array.from({ length: d.sides }, (_, i) => ({
        x: radius * Math.cos((2 * Math.PI * i) / d.sides + Math.PI / 2),
        y: radius * Math.sin((2 * Math.PI * i) / d.sides + Math.PI / 2),
      })),
    );
  } else if (
    ['rectangle', 'square', 'parallelogram', 'trapezoid'].includes(g.shape)
  ) {
    const width = d.width ?? d.side ?? d.base ?? d.b,
      height = d.height ?? d.side;
    const offset =
      g.shape === 'parallelogram'
        ? width * 0.2
        : g.shape === 'trapezoid'
          ? (width - d.a) / 2
          : 0;
    polygon([
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: offset + (d.a ?? width), y: height },
      { x: offset, y: height },
    ]);
    if (['rectangle', 'square'].includes(g.shape))
      line(
        'diagonal',
        [
          { x: 0, y: 0 },
          { x: width, y: height },
        ],
        drawingColors.detail,
      );
  } else if (['cube', 'rectangular prism'].includes(g.shape)) {
    const w = d.length ?? d.side,
      h = d.height ?? d.side,
      depth = d.width ?? d.side;
    const a = { x: 0, y: 0 },
      b = { x: w, y: 0 },
      c = { x: w, y: h },
      e = { x: 0, y: h };
    const shift = (p: Point) => ({
      x: p.x + depth * 0.6,
      y: p.y + depth * 0.35,
    });
    polygon([a, b, c, e]);
    line(
      'back',
      [
        a,
        shift(a),
        shift(b),
        b,
        shift(b),
        shift(c),
        c,
        shift(c),
        shift(e),
        e,
        shift(e),
        shift(a),
      ],
      drawingColors.detail,
    );
    line('space-diagonal', [a, shift(c)], drawingColors.stroke);
  } else {
    const r = d.radius,
      h = d.height ?? 2 * r;
    line('base', arc({ x: 0, y: 0 }, r, r * 0.25));
    if (g.shape === 'sphere') {
      line('outline', arc({ x: 0, y: 0 }, r));
      line('meridian', arc({ x: 0, y: 0 }, r * 0.3, r), drawingColors.detail);
    } else if (g.shape === 'cylinder') {
      line('top', arc({ x: 0, y: h }, r, r * 0.25));
      line('sides', [
        { x: -r, y: 0 },
        { x: -r, y: h },
      ]);
      line('side-right', [
        { x: r, y: 0 },
        { x: r, y: h },
      ]);
    } else
      line('sides', [
        { x: -r, y: 0 },
        { x: 0, y: h },
        { x: r, y: 0 },
      ]);
  }
  const xs = plots.flatMap((p) => p.positions.filter((_, i) => i % 3 === 0));
  const ys = plots.flatMap((p) => p.positions.filter((_, i) => i % 3 === 1));
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-9) * 1.4;
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  const document: GraphDocument = {
    dimension: 2,
    expressions: [],
    angleMode: 'radians',
    presentation: { preset: 'geometry' },
    bounds: {
      min: cx - span / 2,
      max: cx + span / 2,
      y: { min: cy - span / 2, max: cy + span / 2 },
    },
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
