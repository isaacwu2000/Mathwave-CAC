import { expect, test } from 'vitest';
import {
  mathInputLatex,
  mathInputText,
  mathInputNumber,
} from './editor-notation.ts';

test('the editor preserves fractions, powers and command words on a round trip', () => {
  const latex = mathInputLatex('solve (x^2+2*x)/3=1/2', true);
  expect(latex).toContain('\\text{solve }');
  expect(latex).toContain('\\frac');
  expect(mathInputText(latex)).toBe('solve (x^2+2 * x)/(3)=(1)/(2)');
});

test('constant fields evaluate fractions and roots and enforce their numeric domain', () => {
  expect(mathInputNumber('1/2')).toBe(0.5);
  expect(mathInputNumber('sqrt(2)')).toBeCloseTo(1.4142135623730951);
  for (const text of ['', 'x', 'x=2', '1/0', 'sqrt(-1)', 'tan(1)'])
    expect(() => mathInputNumber(text)).toThrow();
  expect(() => mathInputNumber('-1/2', 0)).toThrow('at least');
  expect(() => mathInputNumber('3/2', 0, 1)).toThrow('at most');
  expect(() => mathInputNumber('3/2', 3, 50, true)).toThrow();
  expect(mathInputNumber('6/2', 3, 50, true)).toBe(3);
});

test('paste and recovery retain unsupported notation and ordinary commands', () => {
  expect(mathInputText(mathInputLatex('add graph y=x^2', true))).toBe(
    'add graph y=x^2',
  );
  expect(mathInputText(mathInputLatex('new problem', true))).toBe(
    'new problem',
  );
  expect(mathInputText(mathInputLatex('tan(x)'))).toBe('tan (x)');
  expect(mathInputLatex('\\int_0^1 x^2 dx')).toBe('\\int_0^1 x^2 dx');
});

test('unfinished exponents remain incomplete instead of silently saving the base', () => {
  expect(() => mathInputNumber(mathInputText('2^{}'))).toThrow();
});

test('unsupported structures retain their notation through draft recovery', () => {
  for (const latex of [
    '\\sqrt[3]{8}',
    '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}',
    '\\int_0^1 x^2 dx',
  ])
    expect(mathInputLatex(mathInputText(latex), true)).toBe(latex);
});

test('mixed commands preserve word boundaries and quoted titles', () => {
  expect(mathInputText(mathInputLatex('replace x with 2*x', true))).toBe(
    'replace x with 2 * x',
  );
  expect(
    mathInputText(mathInputLatex('new assignment called "Math"', true)),
  ).toBe('new assignment called "Math"');
});

test('graph inequalities, polar angles and piecewise notation remain editable as plain math', () => {
  for (const source of ['y<=x', 'r=2*cos(theta)', 'y={x<0:-x,x>=0:x^2}']) {
    const roundTrip = mathInputText(mathInputLatex(source));
    expect(roundTrip).not.toContain('\\');
  }
});

test('graph entry preserves multi-letter identifiers without breaking piecewise braces', () => {
  for (const source of [
    'height=2',
    'f(x)=height*x^2',
    'y={x<0:-x,x>=0:x^2}',
    'y=x{x>=0 and x<=3}',
  ]) {
    const result = mathInputText(mathInputLatex(source, false, true), true);
    expect(result.replaceAll(' ', '')).toBe(source.replaceAll(' ', ''));
  }
});
