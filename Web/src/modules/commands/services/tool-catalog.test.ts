import { expect, test } from 'vitest';
import {
  toolCatalog,
  toolInstructions,
  voiceCapabilities,
} from '../config/tool-catalog.ts';
import { runMathProgram } from './math-program.ts';
import { previewGraphCommands } from './graph-build.ts';
import { initialWorkspace } from '../../workspace/state.ts';

test('generated references select actual graph capabilities and omit unrelated controls', () => {
  const graph = toolInstructions('graph');
  expect(graph).toContain('graph.add(');
  expect(graph).toContain('geometry.construct(');
  expect(graph).toContain('problem.save(');
  for (const name of [
    'statistics.mean(',
    'math.solve(',
    'history.undo(',
    'audio.playData(',
  ])
    expect(graph).not.toContain(name);
  const voice = voiceCapabilities();
  expect(voice).toContain('Graphs');
  expect(voice).toContain('Undo');
  expect(voice).not.toContain('graph.add(');
});

test('registered tool kinds preserve read-only, save and standalone control execution', () => {
  expect(toolCatalog['math.solve'].kind).toBe('query');
  expect(toolCatalog['graph.add'].kind).toBe('transform');
  expect(toolCatalog['problem.save'].kind).toBe('save');
  expect(toolCatalog['history.undo'].kind).toBe('control');
  expect(
    runMathProgram(initialWorkspace, 'const g=graph.plot("x^2");').state,
  ).toEqual(initialWorkspace);
  expect(
    runMathProgram(initialWorkspace, 'problem.save(graph.plot("x^2"));').state
      .graph,
  ).toBe(true);
  expect(() =>
    runMathProgram(initialWorkspace, 'history.undo(1); graph.plot("x");'),
  ).toThrow(/standalone|separately/);
  expect(() =>
    previewGraphCommands(initialWorkspace, [
      'typescript\nproblem.save(statistics.data([1,2]));',
    ]),
  ).toThrow(/graph|geometry/);
});

test('the runtime enforces catalog parameters and retains legacy saved names', () => {
  expect(() => runMathProgram(initialWorkspace, 'graph.plot();')).toThrow(
    /expects 1/,
  );
  expect(() => runMathProgram(initialWorkspace, 'graph.plot(4);')).toThrow(
    /string|text/,
  );
  expect(
    runMathProgram(initialWorkspace, 'notebook.save(graph.plot("x^2"));').state
      .graph,
  ).toBe(true);
  expect(
    runMathProgram(initialWorkspace, 'math.evaluate(math.expression("2+3"));')
      .message,
  ).toContain('5');
});
