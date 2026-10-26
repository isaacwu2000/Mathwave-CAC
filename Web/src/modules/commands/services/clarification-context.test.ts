import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  resolveClarification,
  validateClarificationContext,
} from '../index.ts';
import { runCommand } from '../index.ts';
import { createProblemLibrary, currentProblem } from '../../problems/index.ts';
test('short clarification replies preserve original operations and numeric operands', () => {
  const state = runCommand(
    currentProblem(createProblemLibrary()).state,
    'write 2*x+3=11',
  ).state;
  const text = resolveClarification(
    { request: 'subtract three', question: 'From which side?' },
    'both sides',
  );
  assert.equal(text, 'subtract three from both sides');
  assert.match(runCommand(state, text!).state.expression, /11 - 3/);
  assert.equal(
    resolveClarification(
      { request: 'add 17', question: 'To which side?' },
      'to both sides',
    ),
    'add 17 to both sides',
  );
});
test('statistical follow-ups retain data and specify sample or population', () => {
  const request = {
    request: 'variance of 1, 2, 3',
    question: 'Sample or population?',
  };
  const state = currentProblem(createProblemLibrary()).state;
  assert.match(
    runCommand(state, resolveClarification(request, 'sample')!).message,
    /1/,
  );
  assert.equal(
    resolveClarification(request, 'population'),
    'population variance of 1, 2, 3',
  );
});
test('step clarification answers select a number without guessing unrelated intent', () => {
  const pending = {
    request: 'cancel the subtraction',
    question: 'Which step do you mean: 2 or 3?',
  };
  assert.equal(resolveClarification(pending, 'step two'), 'cancel step two');
  assert.equal(resolveClarification(pending, 'write x=9'), null);
  assert.equal(resolveClarification(undefined, 'both sides'), null);
  assert.equal(
    resolveClarification(
      {
        request: 'subtract three from the left side',
        question: 'Which operation?',
      },
      'both sides',
    ),
    null,
  );
  assert.equal(
    resolveClarification(
      {
        request: 'write x=4 then subtract three',
        question: 'From which side?',
      },
      'both sides',
    ),
    null,
  );
});
test('clarification context rejects oversized or malformed requests', () => {
  assert.throws(() =>
    validateClarificationContext({
      request: 'x'.repeat(2001),
      question: 'Which?',
    }),
  );
  assert.throws(() =>
    validateClarificationContext({ request: 'subtract three', question: '' }),
  );
  assert.throws(() =>
    validateClarificationContext({ request: 3, question: 'Which?' }),
  );
  assert.equal(validateClarificationContext(undefined), undefined);
});
