import { expect, test } from 'vitest';
import {
  isGraphBuildRequest,
  isGraphClarificationAnswer,
  runCommand,
} from '../index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
test('opening a graph does not divert read-only math or voice controls into generation', () => {
  const state = runCommand(initialWorkspace, 'graph y=x^2').state;
  for (const request of [
    'roots',
    'intercepts',
    'trace graph 1 at x 2',
    'solve',
    'mute',
    'slower',
    'explain graph',
    'read graph',
  ])
    expect(isGraphBuildRequest(request, state), request).toBe(false);
  expect(isGraphBuildRequest('make it steeper', state)).toBe(true);
  expect(isGraphBuildRequest('graph x cubed', state)).toBe(true);
});

test('a graph question accepts numeric answers without capturing readback or cancellation', () => {
  expect(isGraphClarificationAnswer('five')).toBe(true);
  expect(isGraphClarificationAnswer('from negative 5 to 5')).toBe(true);
  for (const text of [
    'undo',
    'never mind',
    'read my work',
    'mute',
    'stop listening',
  ])
    expect(isGraphClarificationAnswer(text)).toBe(false);
});

test('compound equation and plot requests use the full math interpreter in either order', () => {
  for (const request of [
    'write x squared plus five x plus six equals zero and plot its left side',
    'graph x squared plus five x plus six and write the equation equal to zero',
    'draw a circle and calculate its area',
    'graph x squared and create the equation x squared equals zero',
    'graph x squared and then find its roots',
    'draw a circle of radius five and tell me its area',
  ])
    expect(isGraphBuildRequest(request, initialWorkspace), request).toBe(false);
});
