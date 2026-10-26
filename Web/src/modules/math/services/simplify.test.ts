import { test } from 'vitest';
import assert from 'node:assert/strict';
import { simplifyMath } from '../index.ts';
import { parseMath, formatMath, evaluateMath } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { historyContext } from '../../problems/index.ts';
import { parseHistoryCommand } from '../../commands/index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
} from '../../problems/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
const simplified = (s: string) => formatMath(simplifyMath(parseMath(s)));
test('cancel out simplifies the live equation instead of deleting history', () => {
  let book = createProblemLibrary();
  for (const command of ['write 5x+3=y+1', 'subtract one from both sides']) {
    const result = runCommand(currentProblem(book).state, command);
    book = recordStep(book, result.state, command);
  }
  const before = currentProblem(book).state;
  const command = 'cancel out the addition in the current step';
  assert.equal(parseHistoryCommand(command, historyContext(book)), null);
  const result = runCommand(before, command);
  assert.equal(result.state.expression, '5 * x + 2 = y');
  assert.equal(result.storedCommand, 'simplify');
  book = recordStep(book, result.state, result.storedCommand!);
  assert.equal(currentProblem(book).steps.length, 3);
  assert.deepEqual(currentProblem(undoStep(book)).state, before);
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'simplify', message: '' },
      before,
    ).status,
    'command',
  );
  assert.deepEqual(
    parseHistoryCommand('cancel the subtraction', historyContext(book)),
    { kind: 'cancel', number: 2 },
  );
});
test('additive simplification preserves signs, both sides and multiple variables', () => {
  assert.equal(simplified('5*x+3-1=y+1-1'), '5 * x + 2 = y');
  assert.equal(simplified('x-(3-1)'), 'x - 2');
  assert.equal(simplified('2*x+3*x-y+y+4-9'), '5 * x - 5');
  assert.equal(simplified('3-(x+2)'), '-x + 1');
  assert.equal(simplified('x-x'), '0');
  for (const x of [-3, 0, 2.7])
    assert.equal(
      evaluateMath(parseMath(simplified('2*x+3*x+4-9')), { x }),
      evaluateMath(parseMath('2*x+3*x+4-9'), { x }),
    );
});
test('simplification does not erase undefined fractions or cancel multiplicative factors', () => {
  for (const expression of ['1/x-1/x', '(x*x)/x', '0*(1/x)', '1/0-1/0']) {
    const node = simplifyMath(parseMath(expression));
    assert.throws(() => evaluateMath(node, { x: 0 }));
  }
});
test('division cancellation simplifies numeric factors and preserves both sides', () => {
  let book = createProblemLibrary();
  const write = runCommand(currentProblem(book).state, 'write 2x=y-2');
  book = recordStep(book, write.state, 'write 2x=y-2');
  const divide = runCommand(
    currentProblem(book).state,
    'divide both sides by two',
  );
  book = recordStep(book, divide.state, 'divide both sides by two');
  const command = 'cancel out the division';
  assert.equal(parseHistoryCommand(command, historyContext(book)), null);
  const result = runCommand(divide.state, command);
  assert.equal(result.state.expression, 'x = (y - 2) / 2');
  assert.equal(result.storedCommand, 'simplify');
  book = recordStep(book, result.state, result.storedCommand!);
  assert.deepEqual(currentProblem(undoStep(book)).state, divide.state);
  for (const [input, expected] of [
    ['(x/3)*3', 'x'],
    ['3*(x/3)', 'x'],
    ['(6*x)/3', '2 * x'],
    ['(x*6)/3', '2 * x'],
    ['(x/-2)*2', '-x'],
    ['(x+1)/1', 'x + 1'],
  ]) {
    assert.equal(simplified(input), expected);
    for (const x of [-4, 0, 3])
      assert.equal(
        evaluateMath(parseMath(expected), { x }),
        evaluateMath(parseMath(input), { x }),
      );
  }
});
test('cancel division without an applicable factor leaves work unchanged', () => {
  const state = runCommand(
    currentProblem(createProblemLibrary()).state,
    'write 2x=y-2',
  ).state;
  const result = runCommand(state, 'cancel out the division');
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, state);
  for (const input of ['(x/x)*2', '(x/0)*2', '0*(1/x)', '(x*x)/x'])
    assert.throws(() => evaluateMath(simplifyMath(parseMath(input)), { x: 0 }));
});
test('natural simplification phrases reach math instead of saved-step cancellation', () => {
  let book = createProblemLibrary();
  const write = runCommand(
    currentProblem(book).state,
    'write (6*x)/3+4-1=y+2-2',
  );
  book = recordStep(book, write.state, 'write (6*x)/3+4-1=y+2-2');
  for (const command of [
    'simplify this equation',
    'clean up my work',
    'clean up the current step',
    'reduce the fractions',
    'collect the like terms',
    'combine these constants together',
    'group like terms on both sides',
    'cancel out the division on both sides',
    'cancel the common factors',
    'cancel common numeric factors on both sides',
  ]) {
    assert.equal(
      parseHistoryCommand(command, historyContext(book)),
      null,
      command,
    );
    const result = runCommand(write.state, command);
    assert.equal(result.state.expression, '2 * x + 3 = y', command);
    assert.equal(result.storedCommand, 'simplify');
    assert.deepEqual(write.state, currentProblem(book).state);
  }
});

test('division distributes across sums without dropping undefined terms', () => {
  for (const [input, expected] of [
    ['(4*x+8)/2=20/2', '2 * x + 4 = 10'],
    ['(6*x-9)/-3', '-(2 * x) + 3'],
    ['(x+4)/2', '(x + 4) / 2'],
  ]) {
    assert.equal(simplified(input), expected);
    if (!input.includes('='))
      for (const x of [-2, 0, 3])
        assert.equal(
          evaluateMath(parseMath(simplified(input)), { x }),
          evaluateMath(parseMath(input), { x }),
        );
  }
  for (const input of ['(1/x+4)/2', '(x+1)/0'])
    assert.throws(() => evaluateMath(parseMath(simplified(input)), { x: 0 }));
});
