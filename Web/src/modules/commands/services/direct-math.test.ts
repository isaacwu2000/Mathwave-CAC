import { expect, test } from 'vitest';
import { directMathCommand } from './direct-math.ts';
import { blankWorkspace } from '../../problems/index.ts';

test('only complete explicit equations and both-sides operations use the direct route', () => {
  const state = { ...blankWorkspace(), expression: '2 * x + 3 = 11' };
  expect(
    directMathCommand('Write two x plus three equals eleven.', state),
  ).toBe('Write two x plus three equals eleven');
  expect(directMathCommand('Subtract three from both sides.', state)).toBe(
    'Subtract three from both sides',
  );
  for (const text of [
    'write two x plus',
    'write x equals',
    'write x=4 then divide by two',
    'write x=4 but actually x=5',
    'subtract it from both sides',
    'explain subtract three from both sides',
    'write x=4 if that is correct',
    'Run to x plus three equals eleven',
  ])
    expect(directMathCommand(text, state), text).toBeNull();
  expect(state.expression).toBe('2 * x + 3 = 11');
});

test('clear simplification and readback use the deterministic route without interpreting pronouns or questions', () => {
  const state = { ...blankWorkspace(), expression: '2*x+3-3=11-3' };
  for (const request of [
    'Simplify.',
    'Read the left side.',
    'Read the right side.',
    'Read equation.',
  ])
    expect(directMathCommand(request, state), request).not.toBeNull();
  for (const request of [
    'Simplify that earlier one',
    'Why simplify?',
    'Read the other one',
    'Simplify if it is safe',
    'Read left side then explain it',
  ])
    expect(directMathCommand(request, state), request).toBeNull();
});

test('equation shorthand applies the stated operand to both sides without a model round trip', () => {
  const state = { ...blankWorkspace(), expression: '2*x+3=11' };
  expect(directMathCommand('Subtract three.', state)).toBe(
    'subtract three from both sides',
  );
  expect(directMathCommand('Please subtract three.', state)).toBe(
    'subtract three from both sides',
  );
  expect(directMathCommand('Can you add two?', state)).toBe(
    'add two to both sides',
  );
  expect(directMathCommand('add two', state)).toBe('add two to both sides');
  expect(directMathCommand('divide by two', state)).toBe(
    'divide both sides by two',
  );
  expect(directMathCommand('multiply by four', state)).toBe(
    'multiply both sides by four',
  );
  for (const request of [
    'subtract that',
    'subtract three from the left side',
    'divide by zero',
    'multiply by x',
  ])
    expect(directMathCommand(request, state)).toBeNull();
  expect(
    directMathCommand('subtract three', { ...state, expression: 'x+3' }),
  ).toBeNull();
});

test('explicit unique term edits use the engine but ambiguous or conditional edits do not', () => {
  const state = { ...blankWorkspace(), expression: 'x^2+5*x+2', graph: true };
  expect(directMathCommand('Now change five x to three x.', state)).toBe(
    'change five x to three x',
  );
  expect(directMathCommand('Replace five x with three x.', state)).toBe(
    'Replace five x with three x',
  );
  for (const request of [
    'change x to three x',
    'change five x to three x if correct',
    'change that to three x',
    'change five x to',
    'change five x to three x and solve',
  ])
    expect(directMathCommand(request, state), request).toBeNull();
  expect(state.expression).toBe('x^2+5*x+2');
});

test('dictated factors are written exactly as chosen rather than computed by the app', () => {
  const state = { ...blankWorkspace(), expression: 'x^2+3*x+2', graph: true };
  const request =
    'Write open parenthesis x plus two close parenthesis times open parenthesis x plus one close parenthesis equals zero.';
  expect(directMathCommand(request, state)).toBe(request.slice(0, -1));
});

test('explicit single-function graph dictation stays on the editable deterministic graph path', () => {
  const state = blankWorkspace();
  expect(
    directMathCommand(
      'I’ll graph y equals x squared plus five x plus two.',
      state,
    ),
  ).toBe('graph y = x^2 + 5 * x + 2');
  for (const request of [
    'graph it',
    'graph a circle',
    'graph x and y',
    'graph x^2 then solve',
  ])
    expect(directMathCommand(request, state), request).toBeNull();
});

test('a spoken request to create a graph preserves its explicit equation', () => {
  expect(
    directMathCommand('Create a graph of Y equals X squared', blankWorkspace()),
  ).toBe('graph y = x^2');
});

test('explicit viewport commands use the existing engine without interpreting a function as a final answer', () => {
  const state = { ...blankWorkspace(), expression: 'y=x^2+5*x+2', graph: true };
  expect(directMathCommand('Zoom in.', state)).toBe('Zoom in');
  expect(directMathCommand('zoom in on that other curve', state)).toBeNull();
});
