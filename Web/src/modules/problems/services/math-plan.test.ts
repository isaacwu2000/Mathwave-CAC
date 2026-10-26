import { test } from 'vitest';
import assert from 'node:assert/strict';
import { applyMathPlan, splitMathPlan } from '../index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
  decodeProblemLibrary,
  saveDraft,
} from '../index.ts';
import { validateInterpretation } from '../../commands/index.ts';
import { runCommand } from '../../commands/index.ts';
import { parseMath, evaluateMath } from '../../math/index.ts';
const algebra = [
  'write 2*x+3=11',
  'subtract three from both sides',
  'divide both sides by two',
];
test('ordered AI plans validate against intermediate results and save each mathematical step', () => {
  const book = createProblemLibrary(),
    original = JSON.stringify(book);
  const result = applyMathPlan(book, algebra);
  assert.equal(result.stepsAdded, 3);
  assert.equal(currentProblem(result.book).steps.length, 3);
  const n = parseMath(result.state.expression);
  assert.equal(n.kind, 'equation');
  if (n.kind === 'equation') {
    assert.equal(evaluateMath(n.left, { x: 4 }), 4);
    assert.equal(evaluateMath(n.right), 4);
  }
  assert.equal(JSON.stringify(book), original);
});
test('an entire request can be undone or redone after reload without deleting previous work', () => {
  let book = createProblemLibrary();
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, 'write x=9').state,
    'write x=9',
  );
  const result = applyMathPlan(book, algebra);
  const undone = undoStep(decodeProblemLibrary(JSON.stringify(result.book)));
  assert.deepEqual(currentProblem(undone).steps, currentProblem(book).steps);
  assert.deepEqual(
    currentProblem(redoStep(undone)).steps,
    currentProblem(result.book).steps,
  );
});
test('late failures and ambiguous operands never commit a partial plan or erase a draft', () => {
  const book = saveDraft(createProblemLibrary(), 'my draft');
  for (const commands of [
    ['write x=4', 'add three to both sides', 'divide both sides by zero'],
    ['write x+3=11', 'replace 3 with 4', 'replace 9 with 5'],
    ['write x=4', 'subtract three'],
    ['write x=4', 'export problem'],
    ['write x=4', 'undo'],
    ['write x=4', 'show steps'],
  ]) {
    const before = JSON.stringify(book);
    assert.throws(() => applyMathPlan(book, commands));
    assert.equal(JSON.stringify(book), before);
  }
});
test('statistics plans use freshly entered data and read-only results do not add work steps', () => {
  const result = applyMathPlan(createProblemLibrary(), [
    'data 8, 2, 4, 10',
    'median',
    'mean',
    'range',
  ]);
  assert.match(result.message, /6/);
  assert.equal(result.stepsAdded, 1);
  assert.deepEqual(result.state.data, [8, 2, 4, 10]);
  const readOnly = applyMathPlan(result.book, ['mean', 'median']);
  assert.equal(currentProblem(readOnly.book).steps.length, 1);
  assert.equal(currentProblem(readOnly.book).undoRevisions!.length, 1);
});
test('sequential replacements resolve on updated math, with view updates preserved', () => {
  const result = applyMathPlan(createProblemLibrary(), [
    'write x+3=11',
    'replace 3 with 4',
    'replace 4 with 5',
    'graph',
  ]);
  assert.equal(result.state.expression, 'x + 5 = 11');
  assert.equal(result.state.graph, true);
  assert.equal(result.stepsAdded, 3);
});
test('structured plans reject contradictory, empty, excessive, or malformed model output', () => {
  const state = currentProblem(createProblemLibrary()).state;
  const value = {
    status: 'command',
    command: '',
    commands: algebra,
    message: '',
  };
  assert.deepEqual(validateInterpretation(value, state).commands, algebra);
  for (const bad of [
    { ...value, command: 'solve' },
    { ...value, message: 42 },
    { ...value, status: 'clarification' },
    { ...value, commands: [] },
    { ...value, commands: [''] },
    { ...value, commands: [null] },
    { ...value, commands: Array(7).fill('write x=4') },
  ])
    assert.throws(() => validateInterpretation(bad, state));
});
test('explicit sequencing works locally without splitting mathematical conjunctions', () => {
  assert.deepEqual(
    splitMathPlan(
      'write x=4 then add 3 to both sides and then divide both sides by 2',
    ),
    ['write x=4', 'add 3 to both sides', 'divide both sides by 2'],
  );
  assert.equal(splitMathPlan('write x plus two and three'), null);
  assert.throws(() => splitMathPlan('write x=4;'));
});

test('an internal selection before an edit does not replace the final edit response', () => {
  const book = applyMathPlan(createProblemLibrary(), ['write 2*x+3*y=9']).book;
  const result = applyMathPlan(book, [
    'select part 7',
    'change selected coefficient to five',
  ]);
  assert.match(result.message, /Changed part 7/);
  assert.equal(result.state.expression, '2 * x + 5 * y = 9');
});
