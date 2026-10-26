import { resolveClarification } from '../index.ts';
import { applyHistoryCommand } from '../../problems/index.ts';
import { problemLibraryText } from '../../problems/index.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mathContext } from '../index.ts';
import { runCommand } from '../index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  decodeProblemLibrary,
  cancelStep,
} from '../../problems/index.ts';
import { getParts, parseMath } from '../../math/index.ts';
import { validateInterpretation } from '../index.ts';
import { applyMathPlan } from '../../problems/index.ts';
function equation(text: string) {
  return runCommand(
    currentProblem(createProblemLibrary()).state,
    `write ${text}`,
  ).state;
}
test('a unique coefficient can change without replacing equal constants or the right side', () => {
  const state = equation('2*x+2=2');
  const result = runCommand(state, 'change the coefficient to five');
  assert.equal(result.state.expression, '5 * x + 2 = 2');
  assert.match(result.storedCommand!, /^replace part \d+ matching 2 with 5$/);
  assert.equal(state.expression, '2 * x + 2 = 2');
});
test('multiple coefficients need a variable or a selected term', () => {
  const state = equation('2*x+3*y=9');
  assert.throws(
    () => runCommand(state, 'change the coefficient to five'),
    /Which coefficient/,
  );
  assert.equal(
    runCommand(state, 'change the coefficient of y to five').state.expression,
    '2 * x + 5 * y = 9',
  );
  const parts = getParts(parseMath(state.expression)),
    i = parts.findIndex(
      (p) => p.node.kind === 'variable' && p.node.name === 'x',
    );
  const selected = runCommand(state, `read part ${i + 1}`).state;
  assert.equal(
    runCommand(selected, 'change that coefficient to four').state.expression,
    '4 * x + 3 * y = 9',
  );
});
test('selected occurrence editing works with duplicates and rejects implicit whole-equation targets', () => {
  const state = equation('2*x+2=2');
  assert.throws(
    () => runCommand(state, 'change that to five'),
    /Which term or part/,
  );
  const parts = getParts(parseMath(state.expression)),
    i = parts.findIndex((p) => p.id === 'root.right');
  const selected = runCommand(state, `select part ${i + 1}`).state;
  assert.equal(
    runCommand(selected, 'replace that number with five').state.expression,
    '2 * x + 2 = 5',
  );
  assert.throws(
    () => runCommand(state, 'replace part 900 with 5'),
    /does not exist/,
  );
  assert.throws(
    () => runCommand(state, 'replace part 4 with x=5'),
    /sub-expression/,
  );
});
test('signed coefficients and powers retain the rest of the term', () => {
  assert.equal(
    runCommand(equation('-2*x+3=9'), 'change the coefficient to five').state
      .expression,
    '5 * x + 3 = 9',
  );
  assert.equal(
    runCommand(equation('3*x^2+2=11'), 'change the coefficient of x to five')
      .state.expression,
    '5 * x^2 + 2 = 11',
  );
});
test('context includes numbered selected math and coefficient locations for the interpreter', () => {
  const state = equation('2*x+3*y=9'),
    context = mathContext(state)!;
  assert.equal(context.selected!.part, 1);
  assert.deepEqual(
    context.coefficients.map((c) => c.variable),
    ['x', 'y'],
  );
  for (const coefficient of context.coefficients) {
    assert.equal(
      validateInterpretation(
        {
          status: 'command',
          command: `replace part ${coefficient.part} with 7`,
          message: '',
        },
        state,
      ).status,
      'command',
    );
  }
  assert.equal(mathContext({ ...state, mode: 'statistics' }), undefined);
});
test('canonical saved targets survive reload and undo, and reject replay when the target changed', () => {
  let book = createProblemLibrary();
  for (const text of [
    'write x+3=11',
    'replace 3 with 4',
    'change that to five',
  ]) {
    if (text === 'change that to five') {
      const i = getParts(
        parseMath(currentProblem(book).state.expression),
      ).findIndex((p) => p.node.kind === 'number' && p.node.value === 4);
      const selected = runCommand(
        currentProblem(book).state,
        `read part ${i + 1}`,
      ).state;
      const result = runCommand(selected, text);
      book = recordStep(book, result.state, result.storedCommand!);
    } else {
      const result = runCommand(currentProblem(book).state, text);
      book = recordStep(book, result.state, text);
    }
  }
  const restored = decodeProblemLibrary(JSON.stringify(book));
  assert.equal(
    currentProblem(undoStep(restored)).state.expression,
    'x + 4 = 11',
  );
  const before = JSON.stringify(restored);
  assert.throws(() => cancelStep(restored, 2), /part changed/);
  assert.equal(JSON.stringify(restored), before);
});
test('plans persist structural targets rather than ambiguous conversational references', () => {
  const result = applyMathPlan(createProblemLibrary(), [
    'write 2*x+2=2',
    'change the coefficient to five',
  ]);
  assert.equal(result.state.expression, '5 * x + 2 = 2');
  assert.match(
    currentProblem(result.book).steps[1].command,
    /math\.replacePart/,
  );
});

test('clarification replies identify coefficients or selected parts without writing a new expression', () => {
  const state = equation('2*x+3*y=9');
  const request = {
    request: 'change the coefficient to five',
    question:
      'Which coefficient should change? Select its term or name the variable.',
  };
  const resolved = resolveClarification(request, 'y');
  assert.equal(resolved, 'change the coefficient of y to five');
  assert.equal(
    runCommand(state, resolved!).state.expression,
    '2 * x + 5 * y = 9',
  );
  assert.equal(
    resolveClarification(
      {
        request: 'change that to nine',
        question: 'Which term or part should change?',
      },
      'part seven',
    ),
    'replace part seven with nine',
  );
  assert.equal(
    runCommand(equation('2*x+2=2'), 'replace part seven with nine').state
      .expression,
    '2 * x + 2 = 9',
  );
});
test('displayed requests stay readable while cancellation replays guarded targets', () => {
  const result = applyMathPlan(createProblemLibrary(), [
    'write 2*x+2=2',
    'change the coefficient to five',
  ]);
  assert.equal(
    currentProblem(result.book).steps[1].displayCommand,
    'change the coefficient to five',
  );
  assert.match(
    problemLibraryText(result.book),
    /change the coefficient to five/,
  );
  const cancelled = applyHistoryCommand(
    result.book,
    'cancel the coefficient change',
  )!;
  assert.equal(
    cancelled.book.assignments[0].problems[0].state.expression,
    '2 * x + 2 = 2',
  );
  const bad = JSON.parse(JSON.stringify(result.book));
  bad.assignments[0].problems[0].steps[1].displayCommand = 4;
  assert.throws(() => decodeProblemLibrary(JSON.stringify(bad)));
});

test('AI number context distinguishes signed coefficients, exponents, and equation sides', () => {
  const context = mathContext(equation('-3*x^3+3=3'))!;
  assert.deepEqual(
    context.numbers.map(({ value, side, role, ...rest }) => ({
      value,
      side,
      role,
      variable: rest.variable,
    })),
    [
      { value: '-3', side: 'left', role: 'coefficient', variable: 'x' },
      { value: '3', side: 'left', role: 'exponent', variable: undefined },
      { value: '3', side: 'left', role: 'constant', variable: undefined },
      { value: '3', side: 'right', role: 'constant', variable: undefined },
    ],
  );
  for (const number of context.numbers)
    assert.equal(
      getParts(parseMath('-3*x^3+3=3'))[number.part - 1].id.startsWith('root.'),
      true,
    );
  assert.equal(
    mathContext(equation('2+2'))!.numbers.every((n) => n.side === 'expression'),
    true,
  );
});
