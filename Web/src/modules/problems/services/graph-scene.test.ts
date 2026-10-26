import { expect, test } from 'vitest';
import { applyCloudOperation } from './cloud-problem-library.ts';
import {
  createProblemLibrary,
  currentProblem,
  decodeProblemLibrary,
  undoStep,
  redoStep,
} from './problem-library.ts';
import { mathProgramCommand } from '../../commands/index.ts';

test('a streamed multi-row graph saves once and preserves definitions, names and parameter bounds through recovery', async () => {
  const commands = [
    mathProgramCommand(
      'problem.save(graph.scene(["a=2","f(x)=a*x^2","y=f(x)"]));',
    ),
    mathProgramCommand(
      'const g=graph.add(graph.current(1),"(cos(t),sin(t))"); problem.save(graph.domain(graph.name(g,"Orbit"),0,pi));'.replace(
        '0,pi',
        '0,3.141592653589793',
      ),
    ),
  ];
  const built = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    {
      kind: 'graph',
      commands,
      text: 'compare a named parabola and a half circle',
      baseRevision: 0,
    },
  );
  expect(currentProblem(built.book).steps).toHaveLength(1);
  const reloaded = decodeProblemLibrary(JSON.stringify(built.book));
  expect(currentProblem(reloaded).state.graphScene?.rows[3]).toEqual({
    expression: '(cos(t),sin(t))',
    name: 'Orbit',
    domain: { min: 0, max: Math.PI },
  });
  expect(currentProblem(undoStep(reloaded)).state.graphScene).toBeUndefined();
  expect(currentProblem(redoStep(undoStep(reloaded))).state.graphScene).toEqual(
    currentProblem(reloaded).state.graphScene,
  );
  const corrupt = JSON.parse(JSON.stringify(reloaded));
  currentProblem(corrupt).state.graphScene!.rows[0].expression = 'a=missing';
  expect(() => decodeProblemLibrary(JSON.stringify(corrupt))).toThrow(
    /Undefined/,
  );
});
