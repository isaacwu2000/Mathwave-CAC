import { test } from 'vitest';
import assert from 'node:assert/strict';
import { shouldInterpretWithAI } from '../index.ts';
test('all math, clarification, history and exploration requests use AI first', () => {
  for (const command of [
    'write 2x+3=11',
    'cancel out the division',
    'subtract three',
    'cancel',
    'undo step two',
    'read left side',
    'graph y=x^2',
    'circle radius five',
    'median',
    'both sides',
    'help',
    'next part',
  ])
    assert.equal(shouldInterpretWithAI(command), true, command);
});
test('stop controls and problem operations remain immediate and local', () => {
  for (const command of [
    'stop',
    'please stop listening!',
    'never mind',
    'cancel the question',
    'new problem',
    'new assignment called calculus',
    'export work',
    'open problem 2',
    'rename problem to limits',
    'read steps',
    'save pdf',
  ])
    assert.equal(shouldInterpretWithAI(command), false, command);
});
