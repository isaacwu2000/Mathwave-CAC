import { test, expect } from 'vitest';
import { previewGraphCommands, mathProgramCommand } from '../index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { graphFunction } from '../../visuals/index.ts';

test('progressive graph commands resolve against preceding curves and reject unrelated commands', () => {
  const result = previewGraphCommands(initialWorkspace, [
    'graph y=x^2',
    'add tangent to graph 1 at x 2',
  ]);
  expect(graphFunction(result.state.graphExpressions![0]).value(3)).toBe(8);
  expect(() =>
    previewGraphCommands(initialWorkspace, ['graph y=x^2', 'write 7']),
  ).toThrow();
  expect(initialWorkspace.graph).toBe(false);
});

test('streamed TypeScript programs preserve graph-only preview validation', () => {
  const result = previewGraphCommands(initialWorkspace, [
    mathProgramCommand('problem.save(graph.plot("x^2"));'),
    mathProgramCommand('problem.save(graph.addTangent(graph.current(1), 2));'),
  ]);
  expect(graphFunction(result.state.graphExpressions![0]).value(3)).toBe(8);
  expect(() =>
    previewGraphCommands(initialWorkspace, [
      mathProgramCommand('problem.save(math.equation("x=3"));'),
    ]),
  ).toThrow(/graph/i);
});
