import { expect, test } from 'vitest';
import { applyCloudOperation } from './cloud-problem-library.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
  decodeProblemLibrary,
  cancelStep,
} from './problem-library.ts';
import { mathProgramCommand } from '../../commands/index.ts';
import { graphFunction } from '../../visuals/index.ts';

test('AI programs save atomically, survive backup, and preserve undo and redo', async () => {
  const empty = createProblemLibrary();
  const book = recordStep(
    empty,
    { ...currentProblem(empty).state, expression: '2*x + 3 = 11' },
    'write 2*x+3=11',
  );
  const result = await applyCloudOperation(
    { book, clarification: null },
    {
      kind: 'command',
      text: 'subtract three from both sides and simplify',
      interpret: true,
    },
    async () => ({
      status: 'command',
      command: '',
      commands: [],
      message: '',
      program:
        'const e = problem.currentEquation(); problem.save(math.simplify(math.subtractBothSides(e, 3)));',
    }),
  );
  expect(result.status).toBe('command');
  expect(currentProblem(result.book).state.expression).toBe('2 * x = 8');
  expect(currentProblem(result.book).steps).toHaveLength(2);
  expect(currentProblem(undoStep(result.book)).state.expression).toBe(
    '2*x + 3 = 11',
  );
  expect(currentProblem(redoStep(undoStep(result.book))).state.expression).toBe(
    '2 * x = 8',
  );
  expect(
    currentProblem(decodeProblemLibrary(JSON.stringify(result.book))).state
      .expression,
  ).toBe('2 * x = 8');
  const invalid = await applyCloudOperation(
    { book, clarification: null },
    { kind: 'command', text: 'bad program', interpret: true },
    async () => ({
      status: 'command',
      command: '',
      message: '',
      program: 'problem.save(math.equation("x=4")); fetch("bad");',
    }),
  );
  expect(invalid.book).toBe(book);
});

test('cancelling a curve preserves a later saved viewport program', () => {
  const empty = createProblemLibrary();
  const first = recordStep(
    empty,
    { ...currentProblem(empty).state, expression: 'x^2', graph: true },
    'graph x^2',
  );
  const second = recordStep(
    first,
    { ...currentProblem(first).state, graphExpressions: ['x'] },
    'add graph x',
  );
  const source = mathProgramCommand(
    'problem.save(view.range(graph.current(1), -5, 5, -5, 5));',
  );
  const third = recordStep(
    second,
    {
      ...currentProblem(second).state,
      graphRange: { min: -5, max: 5 },
      graphYRange: { min: -5, max: 5 },
    },
    source,
  );
  const cancelled = cancelStep(third, 2);
  expect(currentProblem(cancelled).state.graphRange).toEqual({
    min: -5,
    max: 5,
  });
  expect(currentProblem(cancelled).state.graphExpressions).toBeUndefined();
});

test('legacy multi-operation responses can contain complete TypeScript programs', async () => {
  const book = createProblemLibrary();
  const result = await applyCloudOperation(
    { book, clarification: null },
    {
      kind: 'command',
      text: 'write an equation and subtract three from both sides',
      interpret: true,
    },
    async () => ({
      status: 'command',
      command: '',
      message: '',
      commands: [
        mathProgramCommand('problem.save(math.equation("x+3=8"));'),
        mathProgramCommand(
          'const e = problem.currentEquation(); problem.save(math.simplify(math.subtractBothSides(e, 3)));',
        ),
      ],
    }),
  );
  expect(result.status).toBe('command');
  expect(currentProblem(result.book).state.expression).toBe('x = 5');
  expect(currentProblem(undoStep(result.book)).state.expression).toBe('0');
});

test('cancelling an earlier step replays complete programs without splitting their semicolons', async () => {
  const empty = createProblemLibrary();
  const book = recordStep(
    empty,
    { ...currentProblem(empty).state, expression: '2*x+3=11' },
    'write 2*x+3=11',
  );
  const redundant = await applyCloudOperation(
    { book, clarification: null },
    { kind: 'command', text: 'add 0 to both sides' },
  );
  const next = await applyCloudOperation(
    redundant,
    {
      kind: 'command',
      text: 'subtract three from both sides and simplify',
      interpret: true,
    },
    async () => ({
      status: 'command',
      command: '',
      message: '',
      program:
        'const e = problem.currentEquation(); const next = math.subtractBothSides(e, 3); problem.save(math.simplify(next));',
    }),
  );
  const cancelled = cancelStep(next.book, 2);
  expect(currentProblem(cancelled).state.expression).toBe('2 * x = 8');
  expect(currentProblem(cancelled).steps).toHaveLength(2);
});

test('progressive graph program groups retain one-step saving and replay after cancellation', async () => {
  const empty = createProblemLibrary();
  const first = recordStep(
    empty,
    { ...currentProblem(empty).state, expression: '0' },
    'write 0',
  );
  const book = recordStep(
    first,
    { ...currentProblem(first).state, expression: '1' },
    'write 1',
  );
  const result = await applyCloudOperation(
    { book, clarification: null },
    {
      kind: 'graph',
      baseRevision: 0,
      text: 'plot a quadratic and its tangent',
      commands: [
        mathProgramCommand('problem.save(graph.plot("x^2"));'),
        mathProgramCommand(
          'const g = graph.current(1); problem.save(graph.addTangent(g, 2));',
        ),
      ],
    },
  );
  expect(currentProblem(result.book).steps).toHaveLength(3);
  const cancelled = cancelStep(result.book, 2);
  expect(
    graphFunction(currentProblem(cancelled).state.graphExpressions![0]).value(
      3,
    ),
  ).toBe(8);
  expect(
    currentProblem(decodeProblemLibrary(JSON.stringify(cancelled))).steps,
  ).toHaveLength(2);
  expect(currentProblem(undoStep(result.book)).state.expression).toBe('1');
});

test('program suggestions require confirmation and corrections replace the original turn', async () => {
  const empty = createProblemLibrary();
  const book = recordStep(
    empty,
    { ...currentProblem(empty).state, expression: '2*x + 3 = 11' },
    'write 2*x+3=11',
  );
  const proposed = await applyCloudOperation(
    { book, clarification: null },
    { kind: 'command', text: 'why subtract three?', interpret: true },
    async () => ({
      status: 'explanation',
      command: '',
      message: 'Subtracting three cancels the constant. I can do that next.',
      program:
        'problem.save(math.simplify(math.subtractBothSides(problem.currentEquation(), 3)));',
    }),
  );
  expect(currentProblem(proposed.book).state.expression).toBe('2*x + 3 = 11');
  const applied = await applyCloudOperation(proposed, {
    kind: 'command',
    text: 'okay do that',
  });
  expect(currentProblem(applied.book).state.expression).toBe('2 * x = 8');
  const corrected = await applyCloudOperation(
    applied,
    {
      kind: 'command',
      text: 'actually subtract five from both sides instead',
      interpret: true,
    },
    async () => ({
      status: 'correction',
      command: '',
      message: '',
      program:
        'problem.save(math.simplify(math.subtractBothSides(problem.currentEquation(), 5)));',
    }),
  );
  expect(corrected.status).toBe('correction');
  expect(currentProblem(corrected.book).state.expression).toBe('2 * x - 2 = 6');
  expect(currentProblem(undoStep(corrected.book)).state.expression).toBe(
    '2 * x = 8',
  );
});

test('program navigation and queries do not add mathematical history', async () => {
  const empty = createProblemLibrary();
  const book = recordStep(
    empty,
    { ...currentProblem(empty).state, expression: '2*x + 3 = 11' },
    'write 2*x+3=11',
  );
  const next = await applyCloudOperation(
    { book, clarification: null },
    { kind: 'command', text: 'next part', interpret: true },
    async () => ({
      status: 'command',
      command: '',
      message: '',
      program: 'problem.save(view.nextPart(problem.currentEquation()));',
    }),
  );
  expect(currentProblem(next.book).state.selection).toBe(1);
  expect(currentProblem(next.book).steps).toHaveLength(1);
  expect(currentProblem(next.book).undoRevisions).toHaveLength(1);
});

test('one request saves an equation and its graph together with atomic recovery', async () => {
  const book = createProblemLibrary();
  const programs = [
    'problem.save(math.equation("x^2+5*x+6=0"));',
    'problem.save(graph.plot("x^2+5*x+6"));',
  ];
  const result = await applyCloudOperation(
    { book, clarification: null },
    {
      kind: 'command',
      text: 'write x squared plus five x plus six equals zero and plot its left side',
      interpret: true,
    },
    async () => ({ status: 'command', command: '', message: '', programs }),
  );
  expect(result.status).toBe('command');
  const problem = currentProblem(result.book);
  expect(problem.steps.map((step) => step.state.expression)).toEqual([
    'x^2 + 5 * x + 6 = 0',
    'x^2 + 5 * x + 6',
  ]);
  expect(problem.state.graph).toBe(true);
  expect(graphFunction(problem.state.expression).value(-2)).toBe(0);
  const restored = decodeProblemLibrary(JSON.stringify(result.book));
  expect(currentProblem(restored).steps).toHaveLength(2);
  expect(currentProblem(undoStep(restored)).steps).toHaveLength(0);
  expect(currentProblem(redoStep(undoStep(restored))).steps).toHaveLength(2);

  const invalid = await applyCloudOperation(
    { book, clarification: null },
    { kind: 'command', text: 'write an equation and plot it', interpret: true },
    async () => ({
      status: 'command',
      command: '',
      message: '',
      programs: [programs[0], 'problem.save(graph.plot("unknown"));'],
    }),
  );
  expect(invalid.book).toBe(book);
});
