import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseMath,
  formatMath,
  speakMath,
  evaluateMath,
  getParts,
  replaceMath,
  solveMath,
} from '../index.ts';

const value = (input: string, vars?: Record<string, number>) =>
  evaluateMath(parseMath(input), vars);

test('natural speech, numeric words, named fractions, and implicit multiplication', () => {
  const equation = parseMath('x squared plus 2 x minus 3 equals zero');
  assert.equal(formatMath(equation), 'x^2 + 2 * x - 3 = 0');
  assert.equal(
    value('open parenthesis three plus one close parenthesis times 2'),
    8,
  );
  assert.equal(value('three quarters plus one half'), 1.25);
  assert.equal(value('one half x', { x: 6 }), 3);
  assert.equal(value('twenty one plus nine'), 30);
  assert.equal(value('2x + 3(x + 1)', { x: 2 }), 13);
  assert.equal(value('(x+1)(x-1)', { x: 3 }), 8);
  assert.equal(value('(x plus 1) over (x minus 2)', { x: 4 }), 2.5);
});

test('operator precedence, right associative powers, unary signs, and scientific numbers', () => {
  assert.equal(value('2 + 3*4^2'), 50);
  assert.equal(value('2^3^2'), 512);
  assert.equal(value('-2^2'), -4);
  assert.equal(value('(-2)^2'), 4);
  assert.equal(value('2^-2'), 0.25);
  assert.equal(value('1e-3 + .5'), 0.501);
  assert.equal(value('8/4/2'), 1);
  assert.equal(value('2×3 + 4²'), 22);
  assert.equal(value('two squared cubed'), 64);
  assert.equal(value('-x squared', { x: 3 }), -9);
});

test('formatting round trips preserve structure, including nonassociative operations', () => {
  for (const input of [
    'x+(y-z)',
    'x-(y+z)',
    'x*(y/z)',
    'x/(y/z)',
    '(x^2)^3',
    'x^(2^3)',
    '-(-x)',
    'x^(-2)',
    '2*(x+1)=5',
    'ln(2+3)',
  ]) {
    const node = parseMath(input);
    assert.deepEqual(parseMath(formatMath(node)), node, input);
  }
});

test('functions have explicit arguments, radians, and checked real domains', () => {
  assert.equal(value('sqrt(9) + log(100)'), 5);
  assert.equal(value('cos(0) + sin(0)'), 1);
  assert.equal(value('ln(1)'), 0);
  assert.equal(
    value('square root of open parenthesis nine close parenthesis'),
    3,
  );
  assert.throws(() => value('sqrt -9'), /argument explicit/);
  assert.throws(() => value('sqrt(-9)'), /not real/);
  assert.throws(() => value('log(0)'), /positive argument/);
  assert.throws(() => value('1/0'), /zero/);
  assert.throws(() => value('0^0'), /undefined/);
  assert.throws(() => value('(-1)^.5'), /finite real/);
  assert.throws(() => value('1e308*10'), /finite real/);
  assert.throws(() => value('x+1'), /Give x a value/);
  assert.throws(() => value('x', { x: Infinity }), /finite number/);
  assert.throws(() => value('1=1'), /two sides/);
});

test('unknown language, ambiguity, malformed expressions, and oversized input fail clearly', () => {
  for (const input of [
    '',
    'x plus',
    '(x+1',
    'x+1)',
    '()',
    'x=2=3',
    'x + * 2',
    '1,000',
    'process.exit()',
    'constructor',
    'xy',
  ]) {
    assert.throws(() => parseMath(input), Error, input);
  }
  assert.throws(() => parseMath('1 over 2 plus 3'), /ambiguous/);
  assert.throws(() => parseMath('1/2x'), /ambiguous/);
  assert.throws(() => parseMath('2 3'), /Adjacent numbers/);
  assert.throws(() => parseMath('2 one half'), /Adjacent numbers|ambiguous/);
  assert.throws(() => parseMath('sin x'), /argument explicit/);
  assert.throws(() => parseMath('hundred'), /recognize/);
  assert.throws(() => parseMath('1e999'), /too large/);
  assert.throws(
    () => parseMath('('.repeat(60) + '1' + ')'.repeat(60)),
    /deep|complex/,
  );
  assert.throws(() => parseMath('1+'.repeat(300) + '1'), /too long/);
  assert.throws(() => parseMath('x'.repeat(5000)), /too long/);
});

test('spoken output keeps grouping and fraction boundaries explicit', () => {
  assert.equal(speakMath(parseMath('x^2')), 'x squared');
  assert.equal(
    speakMath(parseMath('(x+1)/(x-2)')),
    'x plus 1, all divided by the quantity x minus 2 end quantity',
  );
  assert.equal(
    speakMath(parseMath('(x+1)*2')),
    'the quantity x plus 1 end quantity times 2',
  );
  assert.match(speakMath(parseMath('x=2')), /x equals 2/);
  assert.match(speakMath(parseMath('log(100)')), /base ten/);
});

test('equation readback uses natural fractions without redundant grouping', () => {
  assert.equal(
    speakMath(parseMath('(2*x+3-3)/2=(11-3)/2')),
    '2 times x plus 3 minus 3, all divided by 2 equals 11 minus 3, all divided by 2',
  );
  assert.equal(speakMath(parseMath('x/2')), 'x divided by 2');
  assert.equal(
    speakMath(parseMath('x-(2+3)')),
    'x minus the quantity 2 plus 3 end quantity',
  );
});

test('fraction readback preserves nested divisions and surrounding operations', () => {
  const cases = [
    ['1/(2/3)', '1 divided by two thirds'],
    ['(1/2)/3', 'one half divided by 3'],
    ['x/2+3', 'the quantity x divided by 2 end quantity plus 3'],
    ['x/(2+3)', 'x divided by the quantity 2 plus 3 end quantity'],
    ['(x+1)^2', 'the quantity x plus 1 end quantity squared'],
    ['2*x+3', '2 times x plus 3'],
    ['x/(2*y)', 'x divided by the quantity 2 times y end quantity'],
    ['x/(y^2)', 'x divided by the quantity y squared end quantity'],
  ];
  for (const [expression, expected] of cases)
    assert.equal(speakMath(parseMath(expression)), expected, expression);
});

test('common numeric fractions read as names without simplifying the written math', () => {
  const cases = [
    ['1/2', 'one half'],
    ['3/4', 'three quarters'],
    ['2/3', 'two thirds'],
    ['2/4', 'two quarters'],
    ['1/8+3/8', 'one eighth plus three eighths'],
    ['-1/2', 'negative one half'],
    ['11/12', '11 divided by 12'],
    ['5/4', '5 divided by 4'],
    ['(-1/2)^2', 'the quantity negative one half end quantity squared'],
  ];
  for (const [expression, expected] of cases)
    assert.equal(speakMath(parseMath(expression)), expected, expression);
});

test('simple functions omit closing words while complex arguments keep boundaries', () => {
  assert.equal(speakMath(parseMath('sqrt(9)')), 'square root of 9');
  assert.equal(speakMath(parseMath('sin(x)')), 'sine of x');
  assert.equal(speakMath(parseMath('log(100)')), 'base ten logarithm of 100');
  assert.equal(
    speakMath(parseMath('sqrt(x+1)+2')),
    'square root of x plus 1, end square root plus 2',
  );
  assert.equal(
    speakMath(parseMath('sqrt(sqrt(x))')),
    'square root of square root of x, end square root',
  );
});

test('parts have stable unique paths and semantic labels', () => {
  const node = parseMath('(x+1)/2=3');
  const parts = getParts(node);
  assert.equal(parts[0].id, 'root');
  assert.equal(parts[0].node, node);
  assert.equal(
    parts.find((p) => p.id === 'root.left.right')?.label,
    'Denominator',
  );
  assert.equal(new Set(parts.map((p) => p.id)).size, parts.length);
  assert.deepEqual(parts, getParts(node));
});

test('replacement is structural, unique, immutable, and retains intended grouping', () => {
  const source = parseMath('x^2+2*x-3=0');
  const snapshot = structuredClone(source);
  const next = replaceMath(source, 'x squared', 'x + 1');
  assert.deepEqual(source, snapshot);
  assert.notEqual(next, source);
  assert.equal(formatMath(next), 'x + 1 + 2 * x - 3 = 0');
  assert.throws(() => replaceMath(source, 'x', 'y'), /occurs 2 times/);
  assert.throws(() => replaceMath(source, '42', '1'), /No part matches/);
  assert.throws(() => replaceMath(source, '2*x', 'x=1'), /whole equation/);
  assert.equal(
    formatMath(replaceMath(parseMath('2*x'), 'x', 'y+1')),
    '2 * (y + 1)',
  );
});

test('solving supports collected linear and quadratic equations and reports real solution counts', () => {
  assert.match(solveMath(parseMath('2*x+3=7')), /^x = 2\./);
  assert.match(
    solveMath(parseMath('x squared plus 2 x minus 3 equals zero')),
    /^x = -3 or x = 1\./,
  );
  assert.match(solveMath(parseMath('(x-2)^2=0')), /^x = 2 \(a repeated root\)/);
  assert.match(solveMath(parseMath('x^2+1=0')), /No real solutions/);
  assert.match(solveMath(parseMath('2*x+1=2*x+1')), /Every real x/);
  assert.match(solveMath(parseMath('2*x+1=2*x+2')), /No solution/);
  assert.match(solveMath(parseMath('x/2=3')), /^x = 6/);
  assert.match(
    solveMath(parseMath('x^2=2')),
    /x ≈ -1.41421356237 or x ≈ 1.41421356237/,
  );
  assert.match(
    solveMath(parseMath('x^2-100000000*x+1=0')),
    /x ≈ 1e-8|x = 1e-8/,
  );
  assert.match(solveMath(parseMath('1e-20*x=1e-20')), /^x = 1/);
  assert.match(solveMath(parseMath('sqrt(9)*x=6')), /^x = 2/);
});

test('solver rejects unsupported symbolic domains instead of guessing', () => {
  for (const [input, message] of [
    ['x+1', /equals sign/],
    ['y=1', /only equations in x/],
    ['sin(x)=0', /functions containing x/],
    ['1/x=2', /denominator/],
    ['x^3=1', /powers 0, 1, or 2/],
    ['x^2*x=1', /degree at most two/],
    ['2^x=4', /exponent/],
    ['x^0=1', /domain/],
    ['x/0=1', /zero/],
  ] as const)
    assert.throws(() => solveMath(parseMath(input)), message, input);
});

test('step-by-step solving explains transformations and quadratic arithmetic', () => {
  const linear = solveMath(parseMath('2*x+3=7'));
  assert.match(
    linear,
    /1\. Subtract the right side from both sides: \(2 \* x \+ 3\) - \(7\) = 0/,
  );
  assert.match(linear, /2\. Collect like terms: 2\*x - 4 = 0/);
  assert.match(linear, /coefficient of x is 2, and the constant is -4/);
  assert.match(linear, /Subtract the constant from both sides: 2\*x = 4/);
  assert.match(linear, /Divide both sides by 2/);
  const quadratic = solveMath(parseMath('x^2+2*x-3=0'));
  assert.match(quadratic, /a = 1, b = 2, c = -3/);
  assert.match(
    quadratic,
    /D = b\^2 - 4\*a\*c = \(2\)\^2 - 4\*\(1\)\*\(-3\) = 16/,
  );
  assert.match(quadratic, /Apply the quadratic formula/);
  assert.match(quadratic, /two real solutions are x = -3 and x = 1/);
  assert.match(solveMath(parseMath('x^2+2*x+1=0')), /D is zero/);
  assert.match(solveMath(parseMath('x^2+1=0')), /D is negative/);
  assert.match(solveMath(parseMath('x=x')), /true for every real x/);
  assert.match(solveMath(parseMath('x=x+1')), /contradiction/);
  assert.match(
    solveMath(parseMath('1e200*x^2=1e200')),
    /nonzero scale 1e\+200/,
  );
});

test('solver reports unreliable precision instead of inventing degenerate roots', () => {
  assert.throws(
    () => solveMath(parseMath('x^2+1e-300*x=0')),
    /too close to zero/,
  );
  assert.throws(
    () => solveMath(parseMath('x^2+0.2*x+0.01=0')),
    /too close to zero/,
  );
  assert.throws(() => solveMath(parseMath('1e308*x=1e-308')), /too small/);
});
