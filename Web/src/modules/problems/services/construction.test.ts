import { expect, test } from 'vitest';
import { applyCloudOperation } from './cloud-problem-library.ts';
import {
  createProblemLibrary,
  currentProblem,
  undoStep,
  redoStep,
  decodeProblemLibrary,
} from './problem-library.ts';
import { mathProgramCommand } from '../../commands/index.ts';
const source =
  'A=point(0,0)\nB=point(4,0)\nM=midpoint(A,B)\ndraw segment(A,B),M';
const command = mathProgramCommand(
  `problem.save(geometry.construct(${JSON.stringify(source)}));`,
);

test('named geometry saves once, survives reload, undo and redo, and invalid builds leave it intact', async () => {
  const empty = { book: createProblemLibrary(), clarification: null };
  const built = await applyCloudOperation(empty, {
    kind: 'graph',
    text: 'draw segment AB and its midpoint',
    commands: [command],
    baseRevision: 0,
  });
  expect(currentProblem(built.book).steps).toHaveLength(1);
  const restored = decodeProblemLibrary(JSON.stringify(built.book));
  expect(currentProblem(restored).state.construction).toBe(source);
  expect(currentProblem(undoStep(restored)).state.construction).toBeUndefined();
  expect(currentProblem(redoStep(undoStep(restored))).state.construction).toBe(
    source,
  );
  await expect(
    applyCloudOperation(built, {
      kind: 'graph',
      text: 'invalid',
      commands: [
        mathProgramCommand(
          'problem.save(geometry.editObject(geometry.current(),"B","point(0,0)"));',
        ),
      ],
      baseRevision: 1,
    }),
  ).rejects.toThrow(/distinct/);
  expect(currentProblem(built.book).state.construction).toBe(source);
  expect(currentProblem(built.book).steps).toHaveLength(1);
});

test('invalid construction in a backup cannot bypass validation', () => {
  const book = createProblemLibrary();
  currentProblem(book).state.construction =
    'A=point(0,0)\nB=midpoint(A,Z)\ndraw A';
  expect(() => decodeProblemLibrary(JSON.stringify(book))).toThrow(/Undefined/);
});
