import { test, expect } from 'vitest';
import {
  validateExploration,
  explorationView,
  setExplorationValue,
} from '../index.ts';

test('an interactive explanation recomputes its graph and readouts without executing code', () => {
  const lesson = validateExploration({
    title: 'Steeper or flatter?',
    description: 'Change the coefficient and compare the curves.',
    controls: [
      {
        name: 'a',
        label: 'Curve coefficient',
        min: -3,
        max: 3,
        step: 0.5,
        value: 1,
      },
    ],
    plots: ['y=a*x^2', 'y=x^2'],
    readouts: [{ label: 'Height at x = 2', expression: 'a*2^2' }],
    xRange: { min: -5, max: 5 },
    yRange: { min: -10, max: 10 },
  });
  expect(explorationView(lesson).readouts[0].value).toBe('4');
  const changed = setExplorationValue(lesson, 'a', -2);
  expect(explorationView(changed).readouts[0].value).toBe('-8');
  expect(explorationView(changed).plots[0]).toBe('y = -2 * x^2');
  expect(lesson.controls[0].value).toBe(1);
  expect(() =>
    validateExploration({ ...lesson, plots: ['fetch("https://example.com")'] }),
  ).toThrow();
  expect(() =>
    validateExploration({
      ...lesson,
      controls: [{ ...lesson.controls[0], step: 0 }],
    }),
  ).toThrow();
});

test('undefined slider positions are reported and malformed or excessive teaching surfaces are rejected', () => {
  const lesson = validateExploration({
    title: 'Reciprocal',
    description: 'Move the denominator through zero.',
    controls: [
      { name: 'a', label: 'Denominator', min: -2, max: 2, step: 1, value: 1 },
    ],
    plots: [],
    readouts: [{ label: 'Value', expression: '1/a' }],
    xRange: { min: -5, max: 5 },
    yRange: { min: -5, max: 5 },
  });
  expect(
    explorationView(setExplorationValue(lesson, 'a', 0)).readouts[0].value,
  ).toBe('Undefined at these values');
  expect(() => setExplorationValue(lesson, 'a', 3)).toThrow();
  expect(() =>
    validateExploration({
      ...lesson,
      controls: [lesson.controls[0], lesson.controls[0]],
    }),
  ).toThrow();
  expect(() => validateExploration({ ...lesson, plots: ['y=q*x'] })).toThrow(
    /Unknown/,
  );
  expect(() =>
    validateExploration({
      ...lesson,
      plots: ['y=x'],
      readouts: [],
      xRange: { min: 2, max: 2 },
    }),
  ).toThrow();
});

test('interactive plots cannot mislabel residual functions as vertical lines or implicit curves, and controls stay on their step grid', () => {
  const lesson = {
    title: 'Curve',
    description: 'Try the parameter.',
    controls: [{ name: 'a', label: 'a', min: 0, max: 10, step: 2, value: 2 }],
    plots: ['y=a*x'],
    readouts: [],
    xRange: { min: -5, max: 5 },
    yRange: { min: -5, max: 5 },
  };
  expect(() => validateExploration({ ...lesson, plots: ['x=a'] })).toThrow();
  expect(() =>
    validateExploration({ ...lesson, plots: ['x^2+y^2=a^2'] }),
  ).toThrow();
  expect(() =>
    validateExploration({
      ...lesson,
      controls: [{ ...lesson.controls[0], value: 3 }],
    }),
  ).toThrow();
  expect(() =>
    setExplorationValue(validateExploration(lesson), 'a', 3),
  ).toThrow();
});
