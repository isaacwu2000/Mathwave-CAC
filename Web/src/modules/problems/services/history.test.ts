import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  decodeProblemLibrary,
  undoStep,
  redoStep,
  saveDraft,
  startProblem,
} from '../index.ts';
import { applyHistoryCommand, historyContext } from '../index.ts';
import { validateHistoryContext } from '../../commands/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
import { runCommand } from '../../commands/index.ts';
import { parseMath, evaluateMath } from '../../math/index.ts';
test('plain undo, cancel, and cancel out recover the latest change without questions', () => {
  const book = homework();
  const expected = undoStep(book);
  for (const command of [
    'undo',
    'cancel',
    'cancel out',
    'cancel that',
    'cancel out the current step',
  ]) {
    assert.deepEqual(applyHistoryCommand(book, command)!.book, expected);
  }
  assert.deepEqual(
    applyHistoryCommand(book, 'undo step two')!.book,
    applyHistoryCommand(book, 'cancel step two')!.book,
  );
});
function homework(
  commands = [
    'write 2*x+3=11',
    'subtract three from both sides',
    'divide both sides by two',
  ],
) {
  let book = createProblemLibrary();
  for (const command of commands)
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  return book;
}
function sides(book: ReturnType<typeof homework>) {
  const n = parseMath(currentProblem(book).state.expression);
  assert.equal(n.kind, 'equation');
  return n.kind === 'equation'
    ? [evaluateMath(n.left, { x: 4 }), evaluateMath(n.right)]
    : [];
}
test('cancel a named middle step recalculates later work and undo restores the whole original', () => {
  const book = homework(),
    original = JSON.stringify(book);
  const next = applyHistoryCommand(book, 'cancel the subtraction')!.book;
  assert.deepEqual(sides(next), [5.5, 5.5]);
  assert.equal(currentProblem(next).steps.length, 2);
  assert.equal(JSON.stringify(book), original);
  const restored = undoStep(decodeProblemLibrary(JSON.stringify(next)));
  assert.deepEqual(currentProblem(restored).steps, currentProblem(book).steps);
  assert.deepEqual(sides(redoStep(restored)), [5.5, 5.5]);
});
test('return to earlier work, undo and redo survive reload and preserve drafts', () => {
  const book = saveDraft(homework(), 'my unsent thought');
  const earlier = applyHistoryCommand(book, 'go back to step one')!.book;
  assert.equal(currentProblem(earlier).steps.length, 1);
  const undone = applyHistoryCommand(
    decodeProblemLibrary(JSON.stringify(earlier)),
    'undo',
  )!.book;
  assert.equal(currentProblem(undone).steps.length, 3);
  const redone = applyHistoryCommand(undone, 'redo')!.book;
  assert.equal(currentProblem(redone).steps.length, 1);
  assert.equal(redone.draft, 'my unsent thought');
  assert.equal(currentProblem(redone).draft, 'my unsent thought');
});
test('multiple undo/redo, read old work, and edit after undo use the intended branch', () => {
  const book = homework();
  const back = applyHistoryCommand(book, 'go back two steps')!.book;
  assert.equal(currentProblem(back).steps.length, 1);
  assert.equal(
    currentProblem(applyHistoryCommand(back, 'redo two')!.book).steps.length,
    3,
  );
  const read = applyHistoryCommand(book, 'read step one')!;
  assert.equal(read.book, book);
  assert.match(read.message, /Step 1/);
  const edited = recordStep(
    back,
    runCommand(currentProblem(back).state, 'add five to both sides').state,
    'add five to both sides',
  );
  assert.equal(redoStep(edited), edited);
});
test('ambiguous cancellation, invalid bounds, and dependent replacements preserve original work', () => {
  const book = homework([
    'write x+3=11',
    'subtract three from both sides',
    'subtract two from both sides',
  ]);
  const original = JSON.stringify(book);
  assert.throws(
    () => applyHistoryCommand(book, 'cancel subtraction'),
    /Which step/,
  );
  assert.throws(
    () => applyHistoryCommand(book, 'cancel step 99'),
    /does not exist/,
  );
  assert.throws(() => applyHistoryCommand(book, 'undo ten'), /Only 3/);
  assert.equal(JSON.stringify(book), original);
  const dependent = homework([
    'write x+3=11',
    'replace 3 with 4',
    'replace 4 with 5',
  ]);
  const before = JSON.stringify(dependent);
  assert.throws(
    () => applyHistoryCommand(dependent, 'cancel step two'),
    /depends/,
  );
  assert.equal(JSON.stringify(dependent), before);
});
test('legacy problems gain redo and changes remain isolated to the active problem', () => {
  const old = homework();
  delete currentProblem(old).undoRevisions;
  delete currentProblem(old).redoRevisions;
  const restored = redoStep(
    undoStep(decodeProblemLibrary(JSON.stringify(old))),
  );
  assert.deepEqual(currentProblem(restored).steps, currentProblem(old).steps);
  const other = startProblem(old);
  assert.equal(currentProblem(other).steps.length, 0);
  assert.throws(() => applyHistoryCommand(other, 'cancel step 1'));
  assert.deepEqual(other.assignments[0].problems[0], currentProblem(old));
});
test('AI history actions need context, valid targets, and unambiguous schema', () => {
  const book = homework(),
    context = historyContext(book),
    state = currentProblem(book).state;
  const command = (text: string) => ({
    status: 'command',
    command: text,
    message: '',
  });
  for (const text of [
    'cancel step 2',
    'restore step 1',
    'read step 1',
    'redo',
  ]) {
    if (text === 'redo')
      assert.throws(() =>
        validateInterpretation(command(text), state, context),
      );
    else
      assert.equal(
        validateInterpretation(command(text), state, context).command,
        text,
      );
  }
  assert.throws(() => validateInterpretation(command('cancel step 2'), state));
  assert.throws(() =>
    validateInterpretation(command('restore step 900'), state, context),
  );
  assert.throws(() =>
    validateInterpretation(command('new assignment'), state, context),
  );
  assert.throws(() =>
    validateInterpretation(
      { ...command('undo'), message: 'a'.repeat(1001) },
      state,
      context,
    ),
  );
  assert.throws(() =>
    validateInterpretation(
      { status: 'clarification', command: 'undo', message: 'Which?' },
      state,
      context,
    ),
  );
  assert.deepEqual(validateHistoryContext(context), context);
  assert.throws(() => validateHistoryContext({ ...context, undoCount: 51 }));
});
test('recovery snapshots are bounded and malformed imported snapshots are rejected', () => {
  let book = homework();
  for (let i = 0; i < 55; i++)
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, 'write x=4').state,
      'write x=4',
    );
  assert.equal(currentProblem(book).undoRevisions!.length, 50);
  assert.equal(decodeProblemLibrary(JSON.stringify(book)).version, 2);
  const malformed = JSON.parse(JSON.stringify(book));
  malformed.assignments[0].problems[0].undoRevisions[0].steps[0].state.data = [
    NaN,
    1,
  ];
  assert.throws(() => decodeProblemLibrary(JSON.stringify(malformed)));
});

test('fresh conversational history requests resolve by intent and preserve recovery', () => {
  const cases: [string, number][] = [
    ['take me back to just before I divided', 2],
    ['go back to before the subtraction', 1],
    ['return to after I subtracted three', 2],
    ['cancel where I divided by two', 2],
    ['remove the subtraction of three', 2],
    ['cancel my last operation', 2],
    ['undo the last two steps', 1],
    ['go back a step', 2],
    ['undo that', 2],
  ];
  for (const [request, expectedSteps] of cases) {
    const book = homework();
    const result = applyHistoryCommand(book, request)!;
    assert.ok(result, request);
    assert.equal(
      currentProblem(result.book).steps.length,
      expectedSteps,
      request,
    );
    assert.deepEqual(
      currentProblem(
        /^(undo|go back a step)/.test(request)
          ? applyHistoryCommand(
              result.book,
              request.includes('two') ? 'redo two' : 'redo',
            )!.book
          : undoStep(result.book),
      ).steps,
      currentProblem(book).steps,
      request,
    );
  }
  const back = undoStep(homework());
  assert.equal(
    currentProblem(applyHistoryCommand(back, 'put that back')!.book).steps
      .length,
    3,
  );
});
test('AI can expose views and draw shapes without granting problem deletion', () => {
  const book = homework(),
    state = currentProblem(book).state;
  for (const command of [
    'show steps',
    'show more calculations',
    'open voice settings',
    'circle radius 5',
  ]) {
    assert.equal(
      validateInterpretation(
        { status: 'command', command, message: '' },
        state,
        historyContext(book),
      ).command,
      command,
    );
  }
  assert.throws(() =>
    validateInterpretation(
      { status: 'command', command: 'delete all assignments', message: '' },
      state,
      historyContext(book),
    ),
  );
});

test('numbered graph removal bypasses fuzzy history cancellation, including when an edit step matches', () => {
  let book = createProblemLibrary();
  for (const command of [
    'graph y=x^2',
    'add graph y=4',
    'edit graph 2 to y=9',
  ]) {
    const result = runCommand(currentProblem(book).state, command);
    book = recordStep(book, result.state, command);
  }
  for (const command of [
    'remove graph 2',
    'delete curve 2',
    'cancel expression 2',
  ]) {
    assert.equal(applyHistoryCommand(book, command), null);
    const result = runCommand(currentProblem(book).state, command);
    const next = recordStep(book, result.state, command);
    assert.deepEqual(currentProblem(next).state.graphExpressions, []);
    assert.equal(currentProblem(next).steps.length, 4);
    assert.equal(
      currentProblem(next).steps[2].displayCommand,
      'edit graph 2 to y=9',
    );
    assert.deepEqual(currentProblem(undoStep(next)).state.graphExpressions, [
      'y = 9',
    ]);
  }
});
