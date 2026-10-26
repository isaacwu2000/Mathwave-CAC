import { expect, test } from 'vitest';
import { compileGraphScene } from './graph-scene.ts';

test('implicit equations retain both coordinates rather than plotting a residual as y', () => {
  const graph = compileGraphScene({ rows: [{ expression: 'x^2+y^2=4' }] });
  expect(graph.sample(0, 0, 2)).toBe(0);
  expect(graph.sample(0, 0, 0)).toBe(-4);
  expect(graph.rows[0].kind).toBe('implicit');
});

test('named variables and functions resolve forward references and recalculate together', () => {
  const graph = compileGraphScene({
    rows: [
      { expression: 'f(x)=a*x^2' },
      { expression: 'a=2' },
      { expression: 'y=f(x)+1', name: 'Lifted parabola' },
    ],
  });
  expect(graph.sample(0, 3)).toBe(18);
  expect(graph.sample(2, 3)).toBe(19);
  expect(graph.constants.get('a')).toBe(2);
  for (const rows of [
    [{ expression: 'a=b' }, { expression: 'b=a' }],
    [{ expression: 'f(x)=f(x)' }, { expression: 'y=f(x)' }],
    [{ expression: 'y=missing(x)' }],
    [{ expression: 'y={x<0:x,x>=0:missing}' }],
  ])
    expect(() => compileGraphScene({ rows })).toThrow(/Cyclic|Undefined/);
});

test('polar, parametric, restrictions and piecewise functions keep their mathematical domains', () => {
  const graph = compileGraphScene({
    rows: [
      { expression: 'r=2*cos(theta)' },
      { expression: '(3*cos(t),2*sin(t))', domain: { min: 0, max: 6.3 } },
      { expression: 'y={x<0:-x,x>=0:x^2}{x<3}' },
      { expression: 'x=y^2' },
    ],
  });
  expect(graph.point(0, 0)).toEqual({ x: 2, y: 0 });
  expect(graph.point(1, Math.PI / 2)?.y).toBeCloseTo(2);
  expect(graph.point(1, Math.PI / 2)?.x).toBeCloseTo(0);
  expect(graph.sample(2, -2)).toBe(2);
  expect(graph.sample(2, 2)).toBe(4);
  expect(graph.sample(2, 3)).toBeNull();
  expect(graph.point(3, 2)).toEqual({ x: 4, y: 2 });
  expect(
    compileGraphScene({ rows: [{ expression: 'y=2^-2*3' }] }).sample(0, 0),
  ).toBe(0.75);
});

test('unsupported dimensions, invalid constant domains and explosive function expansion fail before saving', () => {
  for (const expression of ['z=2', 'y=sqrt(-1)', 'y=1/0', 'a=1/0'])
    expect(() => compileGraphScene({ rows: [{ expression }] })).toThrow(
      /expression|finite|defined/,
    );
  const rows = [{ expression: 'f0(x)=x' }];
  for (let i = 1; i < 20; i++)
    rows.push({ expression: `f${i}(x)=f${i - 1}(x)+f${i - 1}(x)` });
  expect(() => compileGraphScene({ rows })).toThrow(/complex/);
});

test('comparison chains are conjunctions and reversed equations retain implicit coordinates', () => {
  const graph = compileGraphScene({
    rows: [
      { expression: 'y=x{-2<x<2}' },
      { expression: 'x+y=y' },
      { expression: 'x+y=x' },
      { expression: '-1<x<=1' },
    ],
  });
  expect(graph.sample(0, 10)).toBeNull();
  expect(graph.sample(0, 0)).toBe(0);
  expect(graph.rows[1].kind).toBe('implicit');
  expect(graph.sample(1, 0, 3)).toBe(0);
  expect(graph.rows[2].kind).toBe('implicit');
  expect(graph.sample(2, 3, 0)).toBe(0);
  expect(graph.contains(3, -1, 0)).toBe(false);
  expect(graph.contains(3, 1, 0)).toBe(true);
});

test('function parameters shadow global names and restrictions share the complexity budget', () => {
  expect(
    compileGraphScene({
      rows: [{ expression: 'a=f(1)' }, { expression: 'f(a)=a+1' }],
    }).constants.get('a'),
  ).toBe(2);
  expect(
    compileGraphScene({ rows: [{ expression: 'f(f)=f' }] }).sample(0, 3),
  ).toBe(3);
  const rows = [{ expression: 'f0(x)=1' }];
  for (let i = 1; i < 15; i++)
    rows.push({ expression: `f${i}(x)=1{f${i - 1}(x)+f${i - 1}(x)}` });
  expect(() => compileGraphScene({ rows })).toThrow(/complex/);
});
