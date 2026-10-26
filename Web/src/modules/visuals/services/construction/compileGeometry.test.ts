import { expect, it } from 'vitest';
import { compileGeometry } from './compileGeometry.ts';
import type { ConstructionName, GeometryValue } from './types.ts';

it('annotates measured sides and checked right angles without coordinate axes', () => {
  const result = compileGeometry(
    `A=point(0,0)\nB=point(4,0)\nC=point(0,3)\ndraw triangle(A,B,C)\nmeasure segment(B,C)\nrightangle B,A,C\nangle A,B,C`,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.labels.map((label) => label.text)).toEqual(
    expect.arrayContaining(['A', 'B', 'C', '5', '36.87°']),
  );
  expect(result.expressions.length).toBeGreaterThan(1);
});

it('blocks false right-angle marks and invalid measurement types before rendering', () => {
  for (const annotation of ['rightangle A,B,C', 'measure A', 'angle A,B,B']) {
    const result = compileGeometry(
      `A=point(0,0)\nB=point(4,0)\nC=point(0,3)\ndraw triangle(A,B,C)\n${annotation}`,
    );
    expect(result.status, annotation).toBe('invalid');
    if (result.status === 'invalid')
      expect(result.diagnostics[0]).toMatchObject({ line: 5 });
  }
});

it('keeps every advertised construction aligned with its checked result type', () => {
  const unary: [string, GeometryValue['kind']][] = [['(0.5)', 'scalar']];
  const cases: Record<ConstructionName, [string, GeometryValue['kind']][]> = {
    sqrt: unary,
    cbrt: unary,
    sin: unary,
    cos: unary,
    tan: unary,
    asin: unary,
    acos: unary,
    atan: unary,
    abs: unary,
    exp: unary,
    ln: unary,
    atan2: [['(1,2)', 'scalar']],
    point: [['(1,2)', 'point']],
    line: [['(A,B)', 'line']],
    segment: [['(A,B)', 'segment']],
    ray: [['(A,B)', 'ray']],
    circle: [
      ['(A,B)', 'circle'],
      ['(A,2)', 'circle'],
    ],
    polygon: [['(A,B,C)', 'polygon']],
    triangle: [['(A,B,C)', 'polygon']],
    midpoint: [['(A,B)', 'point']],
    distance: [['(A,B)', 'scalar']],
    foot: [['(C,l)', 'point']],
    reflection: [['(C,l)', 'point']],
    parallel: [
      ['(C,l)', 'line'],
      ['(l,l)', 'boolean'],
    ],
    perpendicular: [
      ['(C,l)', 'line'],
      ['(l,l)', 'boolean'],
    ],
    bisector: [['(A,B,C)', 'line']],
    circumcenter: [['(A,B,C)', 'point']],
    centroid: [['(A,B,C)', 'point']],
    orthocenter: [['(A,B,C)', 'point']],
    incenter: [['(A,B,C)', 'point']],
    circumcircle: [['(A,B,C)', 'circle']],
    incircle: [['(A,B,C)', 'circle']],
    equal: [['(2,2)', 'boolean']],
    on: [
      ['(A,l)', 'boolean'],
      ['(A,segment(A,B))', 'boolean'],
      ['(A,ray(A,B))', 'boolean'],
      ['(B,circle(A,B))', 'boolean'],
    ],
    intersection: [
      ['(l,line(A,C))', 'point'],
      ['(l,circle(A,2),1)', 'point'],
      ['(circle(A,2),l,2)', 'point'],
      ['(circle(A,3),circle(B,3),1)', 'point'],
    ],
  };
  for (const [name, overloads] of Object.entries(cases))
    for (const [args, kind] of overloads) {
      const result = compileGeometry(
        `A=point(0,0)\nB=point(4,0)\nC=point(1,3)\nl=line(A,B)\nvalue=${name}${args}\ndraw A`,
      );
      expect(result.status, `${name}${args}`).toBe('valid');
      if (result.status === 'valid')
        expect(result.values.get('value')?.kind).toBe(kind);
    }
});

it("constructs a right triangle's circumcenter and altitude from named relationships", () => {
  const result = compileGeometry(`A = point(0, 3)
B = point(0, 0)
C = point(4, 0)
D = foot(A, line(B, C))
O = circumcenter(A, B, C)
draw polygon(A, B, C), segment(A, D), circle(O, A)`);
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.values.get('D')).toEqual({ kind: 'point', x: 0, y: 0 });
  expect(result.values.get('O')).toEqual({ kind: 'point', x: 2, y: 1.5 });
  expect(result.expressions).toHaveLength(3);
  expect(result.labels).toEqual(
    expect.arrayContaining([
      { text: 'A', position: [0, 3, 0] },
      { text: 'B = D', position: [0, 0, 0] },
      { text: 'C', position: [4, 0, 0] },
    ]),
  );
});

it('builds common triangle centers, bisectors, parallel and perpendicular constructions', () => {
  const result = compileGeometry(`A=point(0,0)
B=point(4,0)
C=point(0,3)
I=incenter(A,B,C)
G=centroid(A,B,C)
H=orthocenter(A,B,C)
M=midpoint(B,C)
l=bisector(B,A,C)
P=reflection(C,line(A,B))
assert perpendicular(line(A,B),line(A,C))
assert parallel(parallel(C,line(A,B)),line(A,B))
assert on(I,l)
draw triangle(A,B,C), incircle(A,B,C), circumcircle(A,B,C), perpendicular(A,line(B,C)), P`);
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.values.get('I')).toEqual({ kind: 'point', x: 1, y: 1 });
  expect(result.values.get('H')).toEqual({ kind: 'point', x: 0, y: 0 });
  expect(result.values.get('P')).toEqual({ kind: 'point', x: 0, y: -3 });
  expect(result.values.get('M')).toEqual({ kind: 'point', x: 2, y: 1.5 });
});

it('requires an explicit branch for two intersections and verifies geometric assertions before drawing', () => {
  const source = `A=point(-2,0)
B=point(2,0)
O=point(0,0)
c=circle(O,1)
l=line(A,B)
P=intersection(l,c,1)
assert on(P,c)
assert on(P,l)
draw c, P`;
  const result = compileGeometry(source);
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.values.get('P')).toEqual({ kind: 'point', x: -1, y: 0 });
  expect(
    compileGeometry(source.replace('intersection(l,c,1)', 'intersection(l,c)')),
  ).toMatchObject({
    status: 'invalid',
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('branch') }),
    ]),
  });
  expect(
    compileGeometry(
      source.replace('assert on(P,c)', 'assert equal(distance(P,O),2)'),
    ),
  ).toMatchObject({
    status: 'invalid',
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('Assertion'),
      }),
    ]),
  });
});

it('reuses calculator constants and functions to construct an equilateral triangle', () => {
  const result = compileGeometry(`A=point(0,0)
B=point(2,0)
C=point(2*cos(pi/3),sqrt(3))
assert equal(distance(A,B),distance(A,C))
assert equal(distance(A,B),distance(B,C))
draw triangle(A,B,C), incircle(A,B,C)`);
  expect(result.status).toBe('valid');
});

it.each([
  [
    'A=point(0,0)\nB=point(1e200,0)\nP=point(0,1e200)\nassert on(P,line(A,B))\ndraw A',
    'million',
  ],
  [
    'A=point(0,0)\nB=point(1e200,0)\nC=point(1e200,1e200)\nassert parallel(line(A,B),line(A,C))\ndraw A',
    'million',
  ],
  [
    'A=point(0,0)\nB=point(1e200,0)\nC=point(1e200,1e200)\nassert perpendicular(line(A,B),line(A,C))\ndraw A',
    'million',
  ],
  ['A=point(-1e308,0)\nB=point(1e308,0)\nd=distance(A,B)\ndraw A', 'million'],
  ['A=point(0,0)\nB=line(A,3)\ndraw A', 'cannot accept'],
  ['A=midpoint(B,C)\nB=midpoint(A,C)\nC=point(0,0)\ndraw C', 'Cyclic'],
  ['A=point(0,0)\nA=point(1,1)\ndraw A', 'Duplicate'],
  ['a=1e309\nA=point(0,0)\ndraw A', 'finite'],
  ['A=point(0,0)\nB=point(1,1)\nassert on(B,circle(A,1))\ndraw B', 'Assertion'],
])(
  'returns actionable diagnostics and no partial output for invalid source',
  (source, message) => {
    const result = compileGeometry(source);
    expect(result).toMatchObject({
      status: 'invalid',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining(message) }),
      ]),
    });
    expect(result).not.toHaveProperty('expressions');
    expect(result).not.toHaveProperty('values');
  },
);

it('preserves incidence and triangle centers under rotation, translation, and scale', () => {
  for (const scale of [1e-4, 1, 1e4])
    for (const angle of [0, 0.37, 1.91]) {
      const transform = (x: number, y: number) =>
        `${scale * (x * Math.cos(angle) - y * Math.sin(angle)) + 17},${scale * (x * Math.sin(angle) + y * Math.cos(angle)) - 23}`;
      const result = compileGeometry(`A=point(${transform(0, 0)})
B=point(${transform(4, 0)})
C=point(${transform(0, 3)})
O=circumcenter(A,B,C)
I=incenter(A,B,C)
H=orthocenter(A,B,C)
D=foot(C,line(A,B))
assert equal(distance(O,A),distance(O,B))
assert equal(distance(O,A),distance(O,C))
assert on(D,line(A,B))
assert on(I,bisector(B,A,C))
assert on(H,line(A,B))
draw triangle(A,B,C), incircle(A,B,C)`);
      expect(result.status, JSON.stringify(result)).toBe('valid');
    }
});

it.each([
  ['circle(point(0,0),1)', 'circle(point(2,0),1)', 'point(1,0)'],
  ['circle(point(0,0),1)', 'line(point(-2,1),point(2,1))', 'point(0,1)'],
])('finds tangencies without inventing a second branch', (a, b, p) => {
  const source = `a=${a}\nb=${b}\nP=intersection(a,b)\nQ=${p}\nassert on(P,a)\nassert on(P,b)\ndraw a,b,P`;
  const result = compileGeometry(source);
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.values.get('P')).toEqual(result.values.get('Q'));
  expect(
    compileGeometry(source.replace('intersection(a,b)', 'intersection(a,b,2)'))
      .status,
  ).toBe('invalid');
});
