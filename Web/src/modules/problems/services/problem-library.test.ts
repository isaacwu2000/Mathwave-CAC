import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  decodeProblemLibrary,
  problemLibraryText,
} from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { parseMath, evaluateMath } from '../../math/index.ts';

test('spoken operation preserves both sides and a recoverable step history', () => {
  let b = createProblemLibrary();
  let r = runCommand(currentProblem(b).state, 'two x plus three equals eleven');
  b = recordStep(b, r.state, 'two x plus three equals eleven');
  r = runCommand(r.state, 'subtract three from both sides');
  b = recordStep(b, r.state, 'subtract three from both sides');
  const n = parseMath(r.state.expression);
  assert.equal(n.kind, 'equation');
  if (n.kind === 'equation') {
    assert.equal(evaluateMath(n.left, { x: 4 }), 8);
    assert.equal(evaluateMath(n.right), 8);
  }
  const restored = decodeProblemLibrary(JSON.stringify(b));
  assert.equal(currentProblem(restored).steps.length, 2);
  assert.match(problemLibraryText(restored), /subtract three from both sides/);
  assert.match(currentProblem(restored).steps[0].state.expression, /11/);
});
test('ambiguous operations and division by zero do not change saved work', () => {
  const b = createProblemLibrary(),
    s = runCommand(currentProblem(b).state, 'x equals 4').state;
  for (const input of [
    'subtract three',
    'divide both sides by zero',
    'divide both sides by x',
  ])
    assert.throws(() => runCommand(s, input));
  assert.equal(s.expression, 'x = 4');
});
test('invalid saved work is rejected, including invalid step expressions', () => {
  const b = createProblemLibrary();
  assert.throws(() => decodeProblemLibrary('{broken'));
  currentProblem(b).state.expression = 'bad expression !!!';
  assert.throws(() => decodeProblemLibrary(JSON.stringify(b)));
});

test('undo removes the discarded step from work and export, including after reload', async () => {
  const { undoStep } = await import('../index.ts');
  let b = createProblemLibrary();
  b = recordStep(
    b,
    runCommand(currentProblem(b).state, 'x equals 4').state,
    'x equals 4',
  );
  b = recordStep(
    b,
    runCommand(currentProblem(b).state, 'add two to both sides').state,
    'add two to both sides',
  );
  b = undoStep(decodeProblemLibrary(JSON.stringify(b)));
  assert.equal(currentProblem(b).steps.length, 1);
  assert.equal(currentProblem(b).state.expression, 'x = 4');
  assert.doesNotMatch(problemLibraryText(b), /add two/);
  b = undoStep(b);
  assert.equal(currentProblem(b).steps.length, 0);
  assert.equal(currentProblem(b).undoStates?.length, 0);
});
test('view commands do not count as written work', async () => {
  const { contentChanged } = await import('../index.ts');
  const s = currentProblem(createProblemLibrary()).state;
  for (const command of [
    'show graph',
    'hide graph',
    'statistics',
    'equations',
    'read equation',
  ]) {
    const r = runCommand(s, command);
    assert.equal(!!r.written, false, command);
    assert.equal(contentChanged(s, r.state), false, command);
  }
  assert.equal(runCommand(s, 'zero').written, true);
});
test('backup import adds independent copies without replacing existing work or drafts', async () => {
  const { mergeProblemLibrary } = await import('../index.ts');
  const b = createProblemLibrary();
  b.draft = 'unfinished';
  currentProblem(b).draft = 'unfinished';
  const merged = mergeProblemLibrary(b, b);
  assert.equal(merged.assignments.length, 2);
  assert.equal(merged.draft, 'unfinished');
  assert.equal(merged.problemId, b.problemId);
  assert.notEqual(merged.assignments[1].problems[0].id, b.problemId);
  assert.doesNotThrow(() => decodeProblemLibrary(JSON.stringify(merged)));
});
test('old problem log migrates view changes and undo without losing actual work', () => {
  const b = createProblemLibrary();
  const p = currentProblem(b);
  const first = runCommand(p.state, 'x equals 4').state;
  p.steps = [
    { command: 'x equals 4', state: first, at: '' },
    { command: 'show graph', state: { ...first, graph: true }, at: '' },
    {
      command: 'add two',
      state: { ...first, expression: 'x + 2 = 6' },
      at: '',
    },
    { command: 'Undo last change', state: { ...first, graph: true }, at: '' },
  ];
  p.state = { ...first, graph: true };
  const migrated = decodeProblemLibrary(JSON.stringify({ ...b, version: 1 }));
  assert.equal(migrated.version, 2);
  assert.equal(currentProblem(migrated).steps.length, 1);
  assert.equal(currentProblem(migrated).undoStates?.length, 1);
});
