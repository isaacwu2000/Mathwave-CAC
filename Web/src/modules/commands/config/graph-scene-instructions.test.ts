import { expect, test } from 'vitest';
import { graphSceneInstructionsFor } from './graph-scene-instructions.ts';
import { initialWorkspace } from '../../workspace/state.ts';

test('local DSL selection keeps ordinary algebra and explicit graph prompts unchanged', () => {
  for (const text of [
    'subtract three from both sides',
    'graph y=x^2',
    'graph y equals x squared',
    'circle radius five',
    'undo',
  ])
    expect(graphSceneInstructionsFor(text, initialWorkspace)).toBe('');
  for (const text of [
    'graph x squared plus y squared equals four',
    'plot x squared equals four minus y squared',
    'name the first curve Parabola',
    'graph an ellipse',
    'graph r=cos(theta)',
    'Plot r equals two times cosine theta for theta from zero to pi over two.',
    'draw a parametric curve',
  ])
    expect(graphSceneInstructionsFor(text, initialWorkspace)).toContain(
      'graph.scene',
    );
});

test('vertical relations and requests to graph the current equation receive relation tools', () => {
  const solved = { ...initialWorkspace, expression: 'x = 4' };
  for (const text of [
    'graph x equals four',
    'could you plot x = -2.5 please',
    'draw a vertical line through four',
    'plot a line at x four',
    'graph',
    'show graph',
    'graph it',
    'show the graph of this equation',
  ])
    expect(graphSceneInstructionsFor(text, solved)).toContain('graph.scene');
  expect(graphSceneInstructionsFor('simplify', solved)).toBe('');
});
