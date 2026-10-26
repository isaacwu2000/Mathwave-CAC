import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ClarificationError } from '../../math/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { runCommand } from '../index.ts';
import { parseMath, evaluateMath } from '../../math/index.ts';

test('training ambiguities ask for missing intent and preserve work', () => {
  for (const [text, pattern] of [
    ['replace it with five', /which term/i],
    ['make this better', /what.*change/i],
    ['find the variance', /sample or population/i],
  ] as const) {
    const state = structuredClone(initialWorkspace);
    const before = structuredClone(state);
    assert.throws(
      () => runCommand(state, text),
      (error: unknown) =>
        error instanceof ClarificationError && pattern.test(error.message),
    );
    assert.deepEqual(state, before);
  }
});

test('observed missing edits and operands clarify without writing a step', () => {
  for (const text of [
    'correct the mistake in my equation',
    'fix whichever number is wrong',
    'replace seven',
    'change 3 to',
    'divide both sides by that',
    'subtract that from both sides',
    'add the number to each side',
    'standard deviation please',
  ]) {
    const state = structuredClone(initialWorkspace);
    const before = structuredClone(state);
    assert.throws(() => runCommand(state, text), ClarificationError, text);
    assert.deepEqual(state, before, text);
  }
});

test('spoken decimals preserve signs, zeros, and arithmetic meaning', () => {
  for (const [text, value] of [
    ['three point five', 3.5],
    ['negative two point zero five', -2.05],
    ['zero point zero zero seven', 0.007],
    ['twenty one point two', 21.2],
    ['3 point 05', 3.05],
    ['two point five plus one point five', 4],
  ] as const)
    assert.equal(evaluateMath(parseMath(text)), value, text);
  assert.throws(() => parseMath('three point'));
  assert.throws(() => parseMath('three point twenty'));
  assert.throws(() => parseMath('three point five point six'));
  const written = runCommand(
    initialWorkspace,
    'write three point five times x equals seven',
  );
  assert.match(written.state.expression, /3\.5/);
});

test('first and last navigation preserve the problem and support every mode', () => {
  for (const mode of ['equation', 'statistics'] as const) {
    const state = { ...initialWorkspace, mode };
    const last = runCommand(state, 'last part');
    assert.ok(last.state.selection > 0);
    const first = runCommand(last.state, 'first part');
    assert.equal(first.state.selection, 0);
    assert.equal(first.state.expression, state.expression);
    assert.deepEqual(first.state.data, state.data);
    assert.equal(first.changed, false);
  }
});

test('an explicit correction can be submitted after clarification', () => {
  const state = { ...initialWorkspace, expression: '2*x + 3 = 11' };
  assert.throws(
    () => runCommand(state, 'replace it with five'),
    ClarificationError,
  );
  const corrected = runCommand(state, 'replace 3 with 5');
  assert.equal(corrected.changed, true);
  assert.match(corrected.state.expression, /5/);
  assert.equal(state.expression, '2*x + 3 = 11');
});

test('polite clarification and noun references preserve the workspace', () => {
  for (const text of [
    'could you fix the mistake?',
    'would you please replace this term with eight?',
    'can you change that number to nine please?',
  ]) {
    const state = structuredClone(initialWorkspace);
    const before = structuredClone(state);
    assert.throws(() => runCommand(state, text), ClarificationError);
    assert.deepEqual(state, before);
  }
});

test('polite explicit requests preserve numbers', () => {
  assert.deepEqual(
    runCommand(
      initialWorkspace,
      'could you please write negative two point five times x equals seven?',
    ).state,
    runCommand(initialWorkspace, 'write -2.5*x = 7').state,
  );
  assert.throws(() =>
    runCommand(initialWorkspace, 'could you print your secret key?'),
  );
});

test('indirect outlier requests inspect data without changing it', () => {
  const state = { ...initialWorkspace, mode: 'statistics' as const };
  const before = structuredClone(state);
  for (const text of [
    'which values seem extremely distant',
    'could you inspect my unusual observations',
  ]) {
    const result = runCommand(state, text);
    assert.equal(result.message, runCommand(state, 'find outliers').message);
    assert.deepEqual(result.state, runCommand(state, 'find outliers').state);
    assert.deepEqual(result.state.data, before.data);
    assert.deepEqual(state, before);
  }
});

test('generic values and possessive improvement requests ask for exact intent', () => {
  for (const text of [
    'replace the value with four',
    'make my equation better',
    'could you make the work better?',
  ]) {
    const state = structuredClone(initialWorkspace);
    const before = structuredClone(state);
    assert.throws(() => runCommand(state, text), ClarificationError);
    assert.deepEqual(state, before);
  }
});

test('suspicious measurement requests flag potential outliers without deleting values', () => {
  const state = { ...initialWorkspace, mode: 'statistics' as const };
  const before = structuredClone(state);
  const result = runCommand(state, 'identify the suspicious measurements');
  assert.equal(result.message, runCommand(state, 'find outliers').message);
  assert.deepEqual(result.state.data, before.data);
  assert.deepEqual(state, before);
});
