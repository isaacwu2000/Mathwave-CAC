import { parseMath, evaluateMath } from '../../math/index.ts';
import { ClarificationError } from '../../math/index.ts';
export const shapeDimensions = {
  'rectangular prism': ['length', 'width', 'height'],
  cube: ['side'],
  'regular polygon': ['sides', 'side'],
  annulus: ['outer', 'inner'],
  sector: ['radius', 'angle'],
  circle: ['radius'],
  square: ['side'],
  rectangle: ['width', 'height'],
  triangle: ['a', 'b', 'c'],
  'right triangle': ['a', 'b'],
  sphere: ['radius'],
  cylinder: ['radius', 'height'],
  cone: ['radius', 'height'],
  parallelogram: ['base', 'height'],
  trapezoid: ['a', 'b', 'height'],
} as const;
export type Shape = keyof typeof shapeDimensions;
export type Geometry = { shape: Shape; dimensions: Record<string, number> };
const n = (v: number) => Number(v.toPrecision(6)).toString();
export function dimensionsFor(g: Geometry): readonly string[] {
  return g.shape === 'triangle' &&
    ('base' in g.dimensions || 'height' in g.dimensions)
    ? ['base', 'height']
    : shapeDimensions[g.shape];
}
export function validateGeometry(value: Geometry): Geometry {
  if (
    !value ||
    !Object.hasOwn(shapeDimensions, value.shape) ||
    !value.dimensions ||
    typeof value.dimensions !== 'object'
  )
    throw new Error('Invalid geometry.');
  const keys = dimensionsFor(value);
  if (
    Object.keys(value.dimensions).length !== keys.length ||
    keys.some(
      (k) =>
        !Number.isFinite(value.dimensions[k]) ||
        value.dimensions[k] <= 0 ||
        value.dimensions[k] > 1e6,
    )
  )
    throw new Error(
      'Use positive dimensions up to one million, all in the same unit.',
    );
  if (
    value.shape === 'regular polygon' &&
    (!Number.isInteger(value.dimensions.sides) ||
      value.dimensions.sides < 3 ||
      value.dimensions.sides > 50)
  )
    throw new Error('Use a whole-number side count from 3 to 50.');
  if (
    value.shape === 'annulus' &&
    value.dimensions.outer <= value.dimensions.inner
  )
    throw new Error('The outer radius must be greater than the inner radius.');
  if (value.shape === 'sector' && value.dimensions.angle > 360)
    throw new Error(
      'Use a sector angle greater than zero and at most 360 degrees.',
    );
  if (value.shape === 'triangle' && 'a' in value.dimensions) {
    const { a, b, c } = value.dimensions;
    if (a + b <= c || a + c <= b || b + c <= a)
      throw new Error(
        'Those sides cannot form a triangle. Each pair must sum to more than the third side.',
      );
  }
  return value;
}
export function circularSegmentArea(radius: number, angle: number): number {
  validateGeometry({ shape: 'sector', dimensions: { radius, angle } });
  const theta = (angle * Math.PI) / 180;
  // Avoid cancellation in theta - sin(theta) for very small angles.
  const difference =
    theta < 0.01
      ? (theta ** 3 / 6) * (1 - theta ** 2 / 20 + theta ** 4 / 840)
      : theta - Math.sin(theta);
  return (radius * radius * difference) / 2;
}
export function geometryMeasures(g: Geometry) {
  validateGeometry(g);
  const { radius: r, width: w, height: h, side: s, a, b, c } = g.dimensions;
  const metrics: Record<
    string,
    { value: number; formula: string; unit: string }
  > = {};
  const put = (key: string, value: number, formula: string, unit = 'units') => {
    metrics[key] = { value, formula, unit };
  };
  switch (g.shape) {
    case 'regular polygon': {
      const count = g.dimensions.sides;
      put('perimeter', count * s, 'number of sides × side length');
      put(
        'apothem',
        s / (2 * Math.tan(Math.PI / count)),
        'side / (2 × tan(π / number of sides))',
      );
      put(
        'area',
        (count * s * s) / (4 * Math.tan(Math.PI / count)),
        'number of sides × side² / (4 × tan(π / number of sides))',
        'square units',
      );
      put(
        'interior angle',
        ((count - 2) * 180) / count,
        '(number of sides − 2) × 180 / number of sides',
        'degrees',
      );
      put('exterior angle', 360 / count, '360 / number of sides', 'degrees');
      break;
    }
    case 'rectangular prism': {
      const length = g.dimensions.length;
      put('volume', length * w * h, 'length × width × height', 'cubic units');
      put(
        'surface area',
        2 * (length * w + length * h + w * h),
        '2 × (length × width + length × height + width × height)',
        'square units',
      );
      put(
        'space diagonal',
        Math.hypot(length, w, h),
        '√(length² + width² + height²)',
      );
      break;
    }
    case 'cube':
      put('volume', s ** 3, 'side³', 'cubic units');
      put('surface area', 6 * s * s, '6 × side²', 'square units');
      put('space diagonal', Math.sqrt(3) * s, '√3 × side');
      break;
    case 'annulus': {
      const { outer, inner } = g.dimensions;
      put(
        'area',
        Math.PI * (outer - inner) * (outer + inner),
        'π × (outer radius² − inner radius²)',
        'square units',
      );
      put(
        'perimeter',
        2 * Math.PI * (outer + inner),
        'outer circumference + inner circumference',
      );
      put('thickness', outer - inner, 'outer radius − inner radius');
      break;
    }
    case 'sector': {
      const angle = g.dimensions.angle;
      const arc = (2 * Math.PI * r * angle) / 360;
      put('arc length', arc, 'angle / 360 × 2 × π × radius');
      put(
        'segment area',
        circularSegmentArea(r, angle),
        'radius² × (θ − sin θ) / 2, θ in radians; bounded by the specified arc and its chord',
        'square units',
      );
      put(
        'chord length',
        angle === 360 ? 0 : 2 * r * Math.sin((angle * Math.PI) / 360),
        '2 × radius × sin(angle / 2), angle in degrees',
      );
      put(
        'area',
        (Math.PI * r * r * angle) / 360,
        'angle / 360 × π × radius²',
        'square units',
      );
      put(
        'perimeter',
        angle === 360 ? arc : arc + 2 * r,
        angle === 360
          ? 'full circle: 2 × π × radius'
          : 'arc length + 2 × radius',
      );
      break;
    }
    case 'circle':
      put('area', Math.PI * r * r, 'π × radius²', 'square units');
      put('circumference', 2 * Math.PI * r, '2 × π × radius');
      put('diameter', 2 * r, '2 × radius');
      break;
    case 'square':
      put('area', s * s, 'side²', 'square units');
      put('perimeter', 4 * s, '4 × side');
      put('diagonal', Math.hypot(s, s), '√(side² + side²)');
      break;
    case 'rectangle':
      put('area', w * h, 'width × height', 'square units');
      put('perimeter', 2 * (w + h), '2 × (width + height)');
      put('diagonal', Math.hypot(w, h), '√(width² + height²)');
      break;
    case 'triangle': {
      if ('base' in g.dimensions) {
        put(
          'area',
          (g.dimensions.base * h) / 2,
          'base × perpendicular height / 2',
          'square units',
        );
        break;
      }
      const semi = (a + b + c) / 2;
      put(
        'area',
        Math.sqrt(semi * (semi - a) * (semi - b) * (semi - c)),
        '√(s(s−a)(s−b)(s−c)), s = perimeter / 2',
        'square units',
      );
      put('perimeter', a + b + c, 'a + b + c');
      ['a', 'b', 'c'].forEach((key, i) => {
        const v = [a, b, c],
          opposite = v[i],
          adjacent = v[(i + 1) % 3],
          other = v[(i + 2) % 3];
        put(
          `angle ${key}`,
          (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                (adjacent ** 2 + other ** 2 - opposite ** 2) /
                  (2 * adjacent * other),
              ),
            ),
          ) *
            180) /
            Math.PI,
          `cosine rule, opposite side ${key}`,
          'degrees',
        );
      });
      break;
    }
    case 'right triangle':
      put('angle c', 90, 'right angle opposite the hypotenuse', 'degrees');
      put('area', (a * b) / 2, 'leg a × leg b / 2', 'square units');
      put('hypotenuse', Math.hypot(a, b), '√(a² + b²)');
      put('perimeter', a + b + Math.hypot(a, b), 'a + b + hypotenuse');
      put(
        'angle a',
        (Math.atan2(a, b) * 180) / Math.PI,
        'arctan(a / b), opposite leg a',
        'degrees',
      );
      put(
        'angle b',
        (Math.atan2(b, a) * 180) / Math.PI,
        'arctan(b / a), opposite leg b',
        'degrees',
      );
      break;
    case 'parallelogram':
      put(
        'area',
        g.dimensions.base * h,
        'base × perpendicular height',
        'square units',
      );
      break;
    case 'trapezoid':
      put(
        'area',
        ((a + b) * h) / 2,
        '(parallel base a + parallel base b) × perpendicular height / 2',
        'square units',
      );
      break;
    case 'cone': {
      const slant = Math.hypot(r, h);
      put(
        'volume',
        (Math.PI * r * r * h) / 3,
        'π × radius² × height / 3',
        'cubic units',
      );
      put('slant height', slant, '√(radius² + height²)');
      put(
        'surface area',
        Math.PI * r * (r + slant),
        'π × radius × (radius + slant height)',
        'square units',
      );
      break;
    }
    case 'sphere':
      put(
        'volume',
        (4 * Math.PI * r ** 3) / 3,
        '4 × π × radius³ / 3',
        'cubic units',
      );
      put(
        'surface area',
        4 * Math.PI * r * r,
        '4 × π × radius²',
        'square units',
      );
      break;
    case 'cylinder':
      put('volume', Math.PI * r * r * h, 'π × radius² × height', 'cubic units');
      put(
        'surface area',
        2 * Math.PI * r * (r + h),
        '2 × π × radius × (radius + height)',
        'square units',
      );
      break;
  }
  if (
    g.shape === 'right triangle' ||
    (g.shape === 'triangle' && 'a' in g.dimensions)
  ) {
    const sides = [a, b, g.shape === 'right triangle' ? Math.hypot(a, b) : c];
    const area = metrics.area.value;
    const semiperimeter = sides.reduce((sum, side) => sum + side, 0) / 2;
    put('inradius', area / semiperimeter, 'area / semiperimeter');
    put(
      'circumradius',
      (sides[0] * sides[1] * sides[2]) / (4 * area),
      'a × b × c / (4 × area)',
    );
    sides.forEach((side, index) =>
      put(
        `altitude ${['a', 'b', 'c'][index]}`,
        (2 * area) / side,
        `2 × area / side ${['a', 'b', 'c'][index]}`,
      ),
    );
    sides.forEach((side, index) => {
      const other = sides[(index + 1) % 3],
        third = sides[(index + 2) % 3];
      put(
        `median ${['a', 'b', 'c'][index]}`,
        Math.sqrt(
          Math.max(0, 2 * other * other + 2 * third * third - side * side),
        ) / 2,
        `√(2 × other side² + 2 × third side² − side ${['a', 'b', 'c'][index]}²) / 2`,
      );
    });
  }
  return metrics;
}
export function describeGeometry(g: Geometry) {
  validateGeometry(g);
  return `${g.shape[0].toUpperCase() + g.shape.slice(1)}. ${Object.entries(
    g.dimensions,
  )
    .map(([k, v]) =>
      k === 'sides'
        ? `${n(v)} equal sides`
        : `${g.shape === 'right triangle' ? 'leg ' : ''}${k}${['outer', 'inner'].includes(k) ? ' radius' : ''} ${n(v)}${k === 'angle' ? ' degrees' : ''}`,
    )
    .join(', ')}. All lengths use the same unit.`;
}
export function measureGeometry(g: Geometry, metric: string) {
  const name =
    metric === 'perimeter' && g.shape === 'circle'
      ? 'circumference'
      : metric === 'diagonal' && ['cube', 'rectangular prism'].includes(g.shape)
        ? 'space diagonal'
        : metric;
  const m = geometryMeasures(g)[name];
  if (
    !m &&
    g.shape === 'triangle' &&
    'base' in g.dimensions &&
    /^(inradius|circumradius|altitude [abc]|median [abc])$/.test(metric)
  )
    throw new ClarificationError(
      'What are the triangle’s three side lengths? Base and height alone do not determine this measurement.',
    );
  if (!m)
    throw new Error(
      `${metric} is unavailable for this ${g.shape}. Available: ${Object.keys(geometryMeasures(g)).join(', ')}.`,
    );
  return `${name}: ${n(m.value)} ${m.unit}. Formula: ${m.formula}.`;
}
export function geometryNumber(text: string, question: string) {
  try {
    return evaluateMath(parseMath(text));
  } catch {
    throw new ClarificationError(question);
  }
}
export function parseGeometry(input: string): Geometry | null {
  const match = input.match(
    /^(?:(?:draw|create|make|geometry)\s+(?:a\s+)?)?(rectangular prism|cube|regular polygon|annulus|sector|right triangle|parallelogram|trapezoid|rectangle|triangle|cylinder|sphere|circle|square|cone)\b\s*(.*)$/i,
  );
  if (!match) return null;
  const shape = match[1].toLowerCase() as Shape;
  let text = match[2]
    .replace(/^with\s+/i, '')
    .replace(/\b(outer|inner) radius\b/gi, '$1')
    .replace(/\bleg\s+(?=[ab]\b)/gi, '')
    .replace(/\b(?:parallel )?base ([ab])\b/gi, '$1')
    .replace(/^a (?=(?:radius|width|height|base|side)\b)/i, '');
  if (shape === 'rectangle') text = text.replace(/^with\s+(?=\S)/i, 'width ');
  const legs = text.match(/^legs? (.+?) (?:and|,) (.+)$/i);
  if (shape === 'right triangle' && legs) text = `a ${legs[1]} b ${legs[2]}`;
  const sides = text.match(
    /^sides? (.+?)(?:,\s*| and )(.+?)(?:,\s*(?:and )?| and )(.+)$/i,
  );
  if (shape === 'triangle' && sides)
    text = `a ${sides[1]} b ${sides[2]} c ${sides[3]}`;
  const numericSides = text.match(
    /^sides?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i,
  );
  if (shape === 'triangle' && numericSides)
    text = `a ${numericSides[1]} b ${numericSides[2]} c ${numericSides[3]}`;
  if (shape === 'right triangle' && /\bhypotenuse\b/i.test(text)) {
    const known = text.match(/^hypotenuse (.+?) (?:and )?leg (.+)$/i);
    if (!known)
      throw new ClarificationError(
        'What are the hypotenuse and the known leg? Say right triangle hypotenuse thirteen leg five.',
      );
    const hypotenuse = geometryNumber(
      known[1],
      'What is the right triangle hypotenuse?',
    );
    const leg = geometryNumber(
      known[2],
      'What is the right triangle known leg?',
    );
    if (
      ![hypotenuse, leg].every(
        (v) => Number.isFinite(v) && v > 0 && v <= 1e6,
      ) ||
      hypotenuse <= leg
    )
      throw new Error(
        'The hypotenuse must be longer than the positive known leg, with lengths up to one million.',
      );
    return validateGeometry({
      shape,
      dimensions: {
        a: leg,
        b: Math.sqrt((hypotenuse - leg) * (hypotenuse + leg)),
      },
    });
  }
  const dimensions: Record<string, number> = {};
  const labels = [
    ...text.matchAll(
      /\b(radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c)\s+(?:(?:of|is|equals|=)\s*)?/gi,
    ),
  ];
  const expected: readonly string[] =
    shape === 'triangle' && /\b(base|height)\b/i.test(text)
      ? ['base', 'height']
      : shapeDimensions[shape];
  if (text.slice(0, labels[0]?.index ?? text.length).trim())
    throw new ClarificationError(
      'Describe dimensions by name, for example circle radius five.',
    );
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i],
      key = label[1].toLowerCase();
    if (!expected.includes(key) || Object.hasOwn(dimensions, key))
      throw new Error(`Use ${expected.join(', ')} once each for a ${shape}.`);
    const numeric = text
      .slice(label.index! + label[0].length, labels[i + 1]?.index)
      .replace(/(?:,?\s*and|[,;])\s*$/i, '')
      .trim();
    if (!numeric) throw new ClarificationError(`What is the ${shape} ${key}?`);
    dimensions[key] = geometryNumber(numeric, `What is the ${shape} ${key}?`);
  }
  const missing = expected.filter((key) => !Object.hasOwn(dimensions, key));
  if (missing.length)
    throw new ClarificationError(`What is the ${shape} ${missing[0]}?`);
  return validateGeometry({ shape, dimensions });
}

export function scaleGeometry(g: Geometry, factor: number): Geometry {
  validateGeometry(g);
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error('Use a positive finite scale factor.');
  return validateGeometry({
    shape: g.shape,
    dimensions: Object.fromEntries(
      Object.entries(g.dimensions).map(([key, value]) => [
        key,
        ['sides', 'angle'].includes(key) ? value : value * factor,
      ]),
    ),
  });
}

export function classifyTriangle(g: Geometry): string {
  validateGeometry(g);
  if (!['triangle', 'right triangle'].includes(g.shape))
    throw new Error('Open a triangle before classifying it.');
  if (g.shape === 'triangle' && 'base' in g.dimensions)
    throw new ClarificationError(
      'What are the three side lengths? Base and height alone do not determine the triangle type.',
    );
  const { a, b, c } = g.dimensions;
  const sides = [
    a,
    b,
    g.shape === 'right triangle' ? Math.hypot(a, b) : c,
  ].sort((a, b) => a - b);
  const [short, middle, long] = sides;
  const equal = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-10 * Math.max(a, b);
  const sideType = equal(short, long)
    ? 'equilateral'
    : equal(short, middle) || equal(middle, long)
      ? 'isosceles'
      : 'scalene';
  const difference = short ** 2 + middle ** 2 - long ** 2;
  const tolerance = 1e-10 * long ** 2;
  const angleType =
    Math.abs(difference) <= tolerance
      ? 'right'
      : difference > 0
        ? 'acute'
        : 'obtuse';
  return `${sideType[0].toUpperCase() + sideType.slice(1)} ${angleType} triangle. Side equality and right angles use numerical tolerance. ${angleType === 'right' ? 'The longest side is the hypotenuse.' : angleType === 'acute' ? 'All angles are less than 90 degrees.' : 'The angle opposite the longest side is greater than 90 degrees.'}`;
}
