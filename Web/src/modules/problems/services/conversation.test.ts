import { test, expect } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  applyMathPlan,
  rememberConversation,
  correctConversation,
  undoStep,
  redoStep,
  decodeProblemLibrary,
  presentExplanation,
  adjustExplanation,
  startProblem,
} from '../index.ts';
test('a correction replaces the previous turn atomically, survives reload, and undo restores prior work', () => {
  let book = applyMathPlan(createProblemLibrary(), ['write 2*x+3=11']).book;
  const before = book;
  book = applyMathPlan(book, ['subtract 3 from both sides', 'simplify']).book;
  book = rememberConversation(
    before,
    book,
    'subtract three',
    '2x=8',
    'command',
    ['subtract 3 from both sides', 'simplify'],
  );
  const corrected = correctConversation(
    book,
    ['subtract 5 from both sides', 'simplify'],
    'actually I meant five',
  ).book;
  expect(currentProblem(corrected).state.expression).toBe('2 * x - 2 = 6');
  expect(currentProblem(undoStep(corrected)).state.expression).toBe(
    '2 * x = 8',
  );
  expect(currentProblem(redoStep(undoStep(corrected))).state).toEqual(
    currentProblem(corrected).state,
  );
  expect(
    currentProblem(
      decodeProblemLibrary(JSON.stringify(corrected)),
    ).conversation?.at(-1)?.request,
  ).toBe('actually I meant five');
  const again = correctConversation(
    corrected,
    ['subtract 2 from both sides', 'simplify'],
    'no two',
  ).book;
  expect(currentProblem(again).state.expression).toBe('2 * x + 1 = 9');
  expect(() =>
    correctConversation(book, ['divide both sides by 0'], 'actually zero'),
  ).toThrow();
  expect(currentProblem(book).state.expression).toBe('2 * x = 8');
});

test('intervening work invalidates correction even if it recreates the same equation', () => {
  const before = applyMathPlan(createProblemLibrary(), ['write x+3=8']).book;
  let book = applyMathPlan(before, [
    'subtract 3 from both sides',
    'simplify',
  ]).book;
  book = rememberConversation(before, book, 'subtract 3', 'x=5', 'command', [
    'subtract 3 from both sides',
    'simplify',
  ]);
  const intervening = applyMathPlan(book, ['write x=5']).book;
  expect(() =>
    correctConversation(
      intervening,
      ['subtract 2 from both sides', 'simplify'],
      'actually two',
    ),
  ).toThrow(/changed/);
});

test('a repeated identical correction still preserves the original baseline for the next correction', () => {
  const before = applyMathPlan(createProblemLibrary(), ['write x+3=8']).book;
  let book = applyMathPlan(before, [
    'subtract 3 from both sides',
    'simplify',
  ]).book;
  book = rememberConversation(before, book, 'subtract 3', 'x=5', 'command', [
    'subtract 3 from both sides',
    'simplify',
  ]);
  const same = correctConversation(
    book,
    ['subtract 3 from both sides', 'simplify'],
    'actually three',
  ).book;
  const corrected = correctConversation(
    same,
    ['subtract 2 from both sides', 'simplify'],
    'actually two',
  ).book;
  expect(currentProblem(corrected).state.expression).toBe('x + 1 = 6');
});

test('graph corrections validate against original curves and reject invalid replacements atomically', () => {
  const before = applyMathPlan(createProblemLibrary(), [
    'graph y=x',
    'add graph y=x^2',
    'add graph y=x^3',
  ]).book;
  const removed = applyMathPlan(before, ['remove graph 2']).book;
  const book = rememberConversation(
    before,
    removed,
    'remove graph two',
    'Removed.',
    'command',
    ['remove graph 2'],
  );
  const corrected = correctConversation(
    book,
    ['remove graph 3'],
    'No, I meant graph three',
  ).book;
  expect(currentProblem(corrected).state.graphExpressions).toEqual(['y = x^2']);
  expect(() =>
    correctConversation(book, ['remove graph 9'], 'No, nine'),
  ).toThrow();
  expect(currentProblem(book).state).toEqual(currentProblem(removed).state);
});

test('interactive explanations save with their problem without changing homework or leaking into another problem', () => {
  const book = applyMathPlan(createProblemLibrary(), ['write x+4=9']).book;
  const shown = presentExplanation(book, {
    action: 'show',
    content: {
      title: 'Balance',
      description: 'Try taking the same amount from both sides.',
      controls: [
        {
          name: 't',
          label: 'Amount removed',
          min: 0,
          max: 4,
          step: 1,
          value: 0,
        },
      ],
      plots: [],
      readouts: [{ label: 'Equation', expression: 'x+4-t=9-t' }],
      xRange: { min: -5, max: 5 },
      yRange: { min: -5, max: 5 },
    },
  });
  const changed = adjustExplanation(shown, 't', 4);
  const restored = decodeProblemLibrary(JSON.stringify(changed));
  expect(currentProblem(restored).exploration?.controls[0].value).toBe(4);
  expect(currentProblem(restored).state).toEqual(currentProblem(book).state);
  expect(currentProblem(restored).steps).toEqual(currentProblem(book).steps);
  expect(currentProblem(startProblem(restored)).exploration).toBeUndefined();
  expect(
    currentProblem(presentExplanation(restored, { action: 'hide' }))
      .exploration,
  ).toBeUndefined();
});

test('dragging a slider does not evict the preceding conversation', () => {
  const original = createProblemLibrary();
  let book = rememberConversation(
    original,
    original,
    'What does this mean?',
    'Try the control.',
    'reply',
  );
  book = presentExplanation(book, {
    action: 'show',
    content: {
      title: 'Change the slope',
      description: 'Move the coefficient.',
      controls: [
        { name: 'a', label: 'Slope', min: 0, max: 30, step: 1, value: 0 },
      ],
      plots: ['y=a*x'],
      readouts: [],
      xRange: { min: -5, max: 5 },
      yRange: { min: -5, max: 5 },
    },
  });
  for (let value = 1; value <= 20; value++)
    book = adjustExplanation(book, 'a', value);
  expect(currentProblem(book).conversation?.[0].request).toBe(
    'What does this mean?',
  );
  expect(currentProblem(book).conversation?.length).toBe(2);
  expect(currentProblem(book).exploration?.controls[0].value).toBe(20);
});

test('a correction still replaces the original operation after a long read-only conversation', () => {
  const original = applyMathPlan(createProblemLibrary(), [
    'write 2*x+3=11',
  ]).book;
  let book = applyMathPlan(original, [
    'subtract 3 from both sides',
    'simplify',
  ]).book;
  book = rememberConversation(
    original,
    book,
    'Take three off both sides.',
    '2x=8',
    'command',
    ['subtract 3 from both sides', 'simplify'],
  );
  for (let i = 0; i < 80; i++)
    book = rememberConversation(
      book,
      book,
      `Explain detail ${i}.`,
      'Both sides stay equal.',
      'reply',
    );
  const restored = decodeProblemLibrary(JSON.stringify(book));
  const corrected = correctConversation(
    restored,
    ['subtract 5 from both sides', 'simplify'],
    'Actually I meant five in that subtraction.',
  ).book;
  expect(currentProblem(corrected).state.expression).toBe('2 * x - 2 = 6');
  expect(currentProblem(undoStep(corrected)).state.expression).toBe(
    '2 * x = 8',
  );
});
