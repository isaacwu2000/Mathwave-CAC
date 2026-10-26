import { expect, test } from 'vitest';
import { runMathProgram } from '../../Web/src/modules/commands/index.ts';
import { blankWorkspace } from '../../Web/src/modules/problems/index.ts';
import { isRadiusTwoCircle } from './prompt-context-oracles.ts';

test('circle checks use computed membership rather than readback wording', () => {
  const state = runMathProgram(
    blankWorkspace(),
    'problem.save(graph.scene(["x^2+y^2=4"]));',
  ).state;
  expect(isRadiusTwoCircle(state)).toBe(true);
  const wrong = runMathProgram(
    blankWorkspace(),
    'problem.save(graph.scene(["y=4-x^2"]));',
  ).state;
  expect(isRadiusTwoCircle(wrong)).toBe(false);
});
