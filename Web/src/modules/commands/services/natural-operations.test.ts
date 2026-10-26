import { test } from 'vitest';
import assert from 'node:assert/strict';
import { interpretOperation } from '../index.ts';
import { ClarificationError } from '../../math/index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
} from '../../problems/index.ts';
import { runCommand } from '../index.ts';
import { validateInterpretation } from '../index.ts';

test('natural operations preserve the exact operand and act on both equation sides', () => {
  const expression = '2*x+3=11';
  for (const [phrase, canonical] of [
    ['take three away from each side', 'subtract three from both sides'],
    ['take away three from the equation', 'subtract three from both sides'],
    ['subtract three on both sides', 'subtract three from both sides'],
    ['add two on each side of this equation', 'add two to both sides'],
    ['add x+1 to the left and right sides', 'add x+1 to both sides'],
    [
      'multiply the equation by negative two',
      'multiply both sides by negative two',
    ],
    ['divide this equation by two', 'divide both sides by two'],
    ['multiply by three on both sides', 'multiply both sides by three'],
    ['divide by two on each side', 'divide both sides by two'],
    ['double both sides', 'multiply both sides by 2'],
    ['triple the equation', 'multiply both sides by 3'],
    ['halve each side', 'divide both sides by 2'],
  ])
    assert.equal(
      interpretOperation(expression, phrase),
      interpretOperation(expression, canonical),
      phrase,
    );
});

test('natural operations do not guess missing operands or change only one side', () => {
  for (const phrase of [
    'take that away from each side',
    'divide the equation by that',
    'subtract three',
    'divide the left side by two',
  ])
    assert.throws(
      () => interpretOperation('2*x+3=11', phrase),
      ClarificationError,
    );
  for (const phrase of [
    'divide the equation by zero',
    'multiply this equation by x',
  ])
    assert.throws(() => interpretOperation('2*x+3=11', phrase));
  assert.throws(
    () => interpretOperation('2*x+3', 'double both sides'),
    ClarificationError,
  );
});

test('natural operations and cleanup replay correctly through undo and redo', () => {
  let book = createProblemLibrary();
  for (const command of [
    'write 2x+3=11',
    'take three away from each side',
    'clean up my work',
    'divide this equation by two',
    'reduce the equation',
  ]) {
    const result = runCommand(currentProblem(book).state, command);
    book = recordStep(book, result.state, result.storedCommand || command);
  }
  assert.equal(currentProblem(book).state.expression, 'x = 4');
  const undone = undoStep(book);
  assert.equal(currentProblem(undone).state.expression, '2 * x / 2 = 8 / 2');
  assert.equal(currentProblem(redoStep(undone)).state.expression, 'x = 4');
});

test('switching equation sides preserves nested expressions, signs, and recovery', () => {
  const original = '2*(x-3)=y/4';
  for (const phrase of [
    'swap sides',
    'switch the sides of the equation',
    'flip the two sides',
    'reverse sides',
  ]) {
    assert.equal(interpretOperation(original, phrase), 'y / 4 = 2 * (x - 3)');
    assert.equal(
      interpretOperation(interpretOperation(original, phrase)!, phrase),
      '2 * (x - 3) = y / 4',
    );
  }
  assert.throws(
    () => interpretOperation('x+3', 'swap sides'),
    ClarificationError,
  );
  let book = createProblemLibrary();
  for (const command of ['write ' + original, 'swap sides']) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, command);
  }
  assert.equal(
    currentProblem(undoStep(book)).state.expression,
    '2 * (x - 3) = y / 4',
  );
  assert.equal(
    currentProblem(redoStep(undoStep(book))).state.expression,
    'y / 4 = 2 * (x - 3)',
  );
});

test('AI side-swap commands pass validation both alone and within a plan', () => {
  const state = runCommand(
    currentProblem(createProblemLibrary()).state,
    'write x-2=7',
  ).state;
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'swap sides', message: '' },
      state,
    ).command,
    'swap sides',
  );
  assert.deepEqual(
    validateInterpretation(
      {
        status: 'command',
        command: '',
        message: '',
        commands: ['swap sides', 'simplify'],
      },
      state,
    ).commands,
    ['swap sides', 'simplify'],
  );
});
